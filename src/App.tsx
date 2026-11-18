import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import type { AvailabilityBlock, CalendarEvent, CalendarSource } from './types';
import {
  getCurrentWeekStart,
  getLocalTimeZone,
  getTimeZoneOptions,
  getWeekDates,
  mergeAvailabilityBlocks,
  zonedDateMinutesToMs,
} from './utils/temporal';
import { DEMO_CALENDARS, buildDemoEventsForWeek } from './utils/demoData';
import {
  GoogleAuthExpiredError,
  fetchGoogleCalendars,
  fetchGoogleEventsForCalendars,
  requestGoogleAccessToken,
} from './utils/googleCalendar';
import { fetchIcsFromUrl, parseIcsToEvents } from './utils/icsParser';
import { CalendarSidebar } from './components/CalendarSidebar';
import { WeekCalendarGrid } from './components/WeekCalendarGrid';
import { ConnectCalendarDialog } from './components/ConnectCalendarDialog';
import { AvailabilityOutputDialog } from './components/AvailabilityOutputDialog';
import { TimeZoneSelect } from './components/TimeZoneSelect';

const STORAGE_KEYS = {
  clientId: 'slotpicker_gcal_client_id',
  calendars: 'slotpicker_calendars_v1',
  googleEvents: 'slotpicker_gcal_events_v1',
  rawIcs: 'slotpicker_raw_ics_v1',
  availability: 'slotpicker_availability_v1',
  token: 'slotpicker_gcal_token_v1',
  tokenExpiresAt: 'slotpicker_gcal_token_exp_v1',
  lastSyncedAt: 'slotpicker_last_synced_v1',
} as const;

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function formatSyncAge(lastSyncedAt: number | null): string {
  if (!lastSyncedAt) return 'Not synced yet';
  const diffSec = Math.max(0, Math.floor((Date.now() - lastSyncedAt) / 1000));
  if (diffSec < 60) return 'Synced just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Synced ${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `Synced ${diffHr}h ago`;
}

export function App() {
  const localTz = useMemo(() => getLocalTimeZone(), []);
  const timeZoneOptions = useMemo(() => getTimeZoneOptions(), []);

  const [displayTimeZone, setDisplayTimeZone] = useState<string>(localTz);
  const [outputTimeZone, setOutputTimeZone] = useState<string>(localTz);
  const [startOnMonday, setStartOnMonday] = useState<boolean>(false);
  const [showWeekends, setShowWeekends] = useState<boolean>(true);
  const [weekStartDateStr, setWeekStartDateStr] = useState<string>(() =>
    getCurrentWeekStart(localTz, false)
  );

  const [calendars, setCalendars] = useState<CalendarSource[]>(() =>
    readJsonStorage<CalendarSource[]>(STORAGE_KEYS.calendars, DEMO_CALENDARS)
  );
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>(() =>
    readJsonStorage<CalendarEvent[]>(STORAGE_KEYS.googleEvents, [])
  );
  const [icalEventsByCalId, setIcalEventsByCalId] = useState<
    Record<string, CalendarEvent[]>
  >({});
  const [rawIcsByCalId, setRawIcsByCalId] = useState<Record<string, string>>(() =>
    readJsonStorage<Record<string, string>>(STORAGE_KEYS.rawIcs, {})
  );

  const [googleToken, setGoogleToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEYS.token)
  );
  const [googleTokenExpiresAt, setGoogleTokenExpiresAt] = useState<number>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.tokenExpiresAt);
    return raw ? Number(raw) : 0;
  });
  const [savedClientId, setSavedClientId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.clientId) ?? ''
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.lastSyncedAt);
    return raw ? Number(raw) : null;
  });

  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>(() =>
    readJsonStorage<AvailabilityBlock[]>(STORAGE_KEYS.availability, [])
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [, setClockTick] = useState(0);

  // Persist local state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.calendars, JSON.stringify(calendars));
  }, [calendars]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.googleEvents, JSON.stringify(googleEvents));
  }, [googleEvents]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.rawIcs, JSON.stringify(rawIcsByCalId));
  }, [rawIcsByCalId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.availability, JSON.stringify(availabilityBlocks));
  }, [availabilityBlocks]);

  // Periodically update "Synced Xm ago" label
  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const weekWindow = useMemo(() => {
    const days = getWeekDates(weekStartDateStr);
    const startMs = zonedDateMinutesToMs(days[0], 0, displayTimeZone);
    const endMs = zonedDateMinutesToMs(days[6], 24 * 60, displayTimeZone);
    return {
      startMs,
      endMs,
      timeMinIso: new Date(startMs).toISOString(),
      timeMaxIso: new Date(endMs).toISOString(),
    };
  }, [weekStartDateStr, displayTimeZone]);

  // Demo events for the visible week (if any demo calendars exist)
  const demoEvents = useMemo(() => {
    if (!calendars.some((c) => c.provider === 'demo')) return [];
    return buildDemoEventsForWeek(weekStartDateStr, displayTimeZone);
  }, [calendars, weekStartDateStr, displayTimeZone]);

  // Re-parse cached ICS text whenever the visible week changes (for recurring events)
  useEffect(() => {
    const updated: Record<string, CalendarEvent[]> = {};
    for (const [calId, icsText] of Object.entries(rawIcsByCalId)) {
      const parsed = parseIcsToEvents(
        icsText,
        calId,
        weekWindow.startMs,
        weekWindow.endMs
      );
      updated[calId] = parsed.events;
    }
    setIcalEventsByCalId(updated);
  }, [rawIcsByCalId, weekWindow.startMs, weekWindow.endMs]);

  const saveToken = (token: string, expiresAt: number) => {
    setGoogleToken(token);
    setGoogleTokenExpiresAt(expiresAt);
    setNeedsReauth(false);
    localStorage.setItem(STORAGE_KEYS.token, token);
    localStorage.setItem(STORAGE_KEYS.tokenExpiresAt, String(expiresAt));
  };

  const markSynced = () => {
    const now = Date.now();
    setLastSyncedAt(now);
    localStorage.setItem(STORAGE_KEYS.lastSyncedAt, String(now));
  };

  // Fetch Google OAuth events when week changes and token is still valid
  const refreshGoogleEvents = useCallback(
    async (token: string, cals: CalendarSource[]) => {
      const evs = await fetchGoogleEventsForCalendars(
        token,
        cals,
        weekWindow.timeMinIso,
        weekWindow.timeMaxIso
      );
      setGoogleEvents(evs);
      markSynced();
    },
    [weekWindow.timeMinIso, weekWindow.timeMaxIso]
  );

  useEffect(() => {
    const hasGoogleCals = calendars.some((c) => c.provider === 'google-oauth');
    if (!hasGoogleCals || !googleToken) return;
    if (Date.now() >= googleTokenExpiresAt - 30_000) {
      setNeedsReauth(true);
      return;
    }

    refreshGoogleEvents(googleToken, calendars).catch((err) => {
      if (err instanceof GoogleAuthExpiredError) {
        setNeedsReauth(true);
      } else {
        setStatusMessage(
          err instanceof Error ? err.message : 'Failed to refresh Google events.'
        );
      }
    });
  }, [googleToken, googleTokenExpiresAt, calendars, refreshGoogleEvents]);

  const allEvents = useMemo(() => {
    return [
      ...demoEvents,
      ...googleEvents,
      ...Object.values(icalEventsByCalId).flat(),
    ];
  }, [demoEvents, googleEvents, icalEventsByCalId]);

  const handleConnectGoogleOAuth = async (clientId: string) => {
    localStorage.setItem(STORAGE_KEYS.clientId, clientId);
    setSavedClientId(clientId);

    const { accessToken, expiresAt } = await requestGoogleAccessToken(clientId);
    saveToken(accessToken, expiresAt);
    const gcalList = await fetchGoogleCalendars(accessToken);

    setCalendars((prev) => {
      const prevEnabled = new Map(prev.map((c) => [c.id, c.enabled]));
      const mergedGcal = gcalList.map((c) => ({
        ...c,
        enabled: prevEnabled.has(c.id) ? prevEnabled.get(c.id)! : c.enabled,
      }));
      const nonDemoNonGcal = prev.filter(
        (c) => c.provider !== 'demo' && c.provider !== 'google-oauth'
      );
      return [...mergedGcal, ...nonDemoNonGcal];
    });

    await refreshGoogleEvents(accessToken, gcalList);
    setStatusMessage(`Connected ${gcalList.length} Google Calendar(s) and saved locally.`);
  };

  const handleAddIcalUrl = async (name: string, url: string, color: string) => {
    const icsText = await fetchIcsFromUrl(url);
    const id = `ical:${crypto.randomUUID()}`;
    const parsed = parseIcsToEvents(
      icsText,
      id,
      weekWindow.startMs,
      weekWindow.endMs
    );

    const newCal: CalendarSource = {
      id,
      name:
        name === 'Google Calendar (iCal)' && parsed.calendarName
          ? parsed.calendarName
          : name,
      color,
      enabled: true,
      provider: 'ical-url',
      icalUrl: url,
    };

    setRawIcsByCalId((prev) => ({ ...prev, [id]: icsText }));
    setCalendars((prev) => [...prev.filter((c) => c.provider !== 'demo'), newCal]);
    markSynced();
    setStatusMessage(`Added "${newCal.name}" and saved locally.`);
  };

  const handleAddIcalFile = async (name: string, icsText: string, color: string) => {
    const id = `icsfile:${crypto.randomUUID()}`;
    const parsed = parseIcsToEvents(
      icsText,
      id,
      weekWindow.startMs,
      weekWindow.endMs
    );

    const newCal: CalendarSource = {
      id,
      name:
        parsed.calendarName && name === 'Imported Calendar'
          ? parsed.calendarName
          : name,
      color,
      enabled: true,
      provider: 'ical-file',
    };

    setRawIcsByCalId((prev) => ({ ...prev, [id]: icsText }));
    setCalendars((prev) => [...prev.filter((c) => c.provider !== 'demo'), newCal]);
    markSynced();
    setStatusMessage(`Imported "${newCal.name}" and saved locally.`);
  };

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    setStatusMessage(null);
    try {
      const hasGoogleCals = calendars.some((c) => c.provider === 'google-oauth');
      if (hasGoogleCals) {
        let activeToken = googleToken;
        const isExpired =
          !activeToken || Date.now() >= googleTokenExpiresAt - 30_000 || needsReauth;

        if (isExpired) {
          if (!savedClientId) {
            setConnectOpen(true);
            setIsRefreshing(false);
            return;
          }
          const res = await requestGoogleAccessToken(savedClientId);
          saveToken(res.accessToken, res.expiresAt);
          activeToken = res.accessToken;
        }

        // Re-sync both calendar list and events
        const freshCals = await fetchGoogleCalendars(activeToken!);
        setCalendars((prev) => {
          const prevEnabled = new Map(prev.map((c) => [c.id, c.enabled]));
          const mergedGcal = freshCals.map((c) => ({
            ...c,
            enabled: prevEnabled.has(c.id) ? prevEnabled.get(c.id)! : c.enabled,
          }));
          const others = prev.filter((c) => c.provider !== 'google-oauth');
          return [...mergedGcal, ...others];
        });
        await refreshGoogleEvents(activeToken!, freshCals);
      }

      const icalCals = calendars.filter(
        (c) => c.provider === 'ical-url' && c.icalUrl
      );
      if (icalCals.length > 0) {
        const nextRaw: Record<string, string> = {};
        for (const cal of icalCals) {
          nextRaw[cal.id] = await fetchIcsFromUrl(cal.icalUrl!);
        }
        setRawIcsByCalId((prev) => ({ ...prev, ...nextRaw }));
        markSynced();
      }

      setStatusMessage('Calendars synced.');
    } catch (err) {
      if (err instanceof GoogleAuthExpiredError) {
        setNeedsReauth(true);
        setStatusMessage('Google session expired. Click Refresh to sign in again.');
      } else {
        setStatusMessage(err instanceof Error ? err.message : 'Refresh failed.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleCalendar = (id: string) => {
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))
    );
  };

  const handleRemoveCalendar = (id: string) => {
    setCalendars((prev) => prev.filter((c) => c.id !== id));
    setRawIcsByCalId((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleLoadDemo = () => {
    setCalendars((prev) => {
      const existingNonDemo = prev.filter((c) => c.provider !== 'demo');
      return [...existingNonDemo, ...DEMO_CALENDARS];
    });
  };

  const handleAddAvailability = (startMs: number, endMs: number) => {
    setAvailabilityBlocks((prev) =>
      mergeAvailabilityBlocks([
        ...prev,
        { id: crypto.randomUUID(), startMs, endMs },
      ])
    );
  };

  const handleRemoveAvailability = (id: string) => {
    setAvailabilityBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const shiftWeek = (deltaDays: number) => {
    const next = Temporal.PlainDate.from(weekStartDateStr).add({ days: deltaDays });
    setWeekStartDateStr(next.toString());
  };

  const handleJumpToday = () => {
    setWeekStartDateStr(getCurrentWeekStart(displayTimeZone, startOnMonday));
  };

  const handleToggleStartOnMonday = (val: boolean) => {
    setStartOnMonday(val);
    const current = Temporal.PlainDate.from(weekStartDateStr);
    const shifted = val ? current.add({ days: 1 }) : current.subtract({ days: 1 });
    setWeekStartDateStr(shifted.toString());
  };

  const weekRangeLabel = useMemo(() => {
    const days = getWeekDates(weekStartDateStr);
    const startZ = Temporal.PlainDate.from(days[0]).toZonedDateTime({
      timeZone: displayTimeZone,
      plainTime: '12:00',
    });
    const endZ = Temporal.PlainDate.from(days[6]).toZonedDateTime({
      timeZone: displayTimeZone,
      plainTime: '12:00',
    });
    const startStr = startZ.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endZ.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startStr} – ${endStr}`;
  }, [weekStartDateStr, displayTimeZone]);

  const isDemoOnly =
    calendars.length > 0 && calendars.every((c) => c.provider === 'demo');
  const hasRealCalendars = calendars.some((c) => c.provider !== 'demo');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <span className="brand-icon">
              <Calendar size={18} />
            </span>
            <span className="brand-title">SlotPicker</span>
          </div>

          <div className="week-nav">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleJumpToday}
            >
              Today
            </button>
            <div className="week-arrows">
              <button
                type="button"
                className="icon-btn"
                onClick={() => shiftWeek(-7)}
                aria-label="Previous week"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => shiftWeek(7)}
                aria-label="Next week"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <h1 className="week-range-title">{weekRangeLabel}</h1>
          </div>
        </div>

        <div className="topbar-right">
          {isDemoOnly && (
            <button
              type="button"
              className="demo-pill"
              onClick={() => setConnectOpen(true)}
            >
              <Sparkles size={13} />
              Sample data · Connect Google Calendar
            </button>
          )}

          {hasRealCalendars && (
            <button
              type="button"
              className={`btn btn-secondary btn-sm sync-btn ${needsReauth ? 'needs-sync' : ''}`}
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              title="Refresh calendars if out of sync"
            >
              <RefreshCw size={13} className={isRefreshing ? 'spin' : ''} />
              <span>
                {isRefreshing
                  ? 'Syncing...'
                  : needsReauth
                    ? 'Out of sync · Refresh'
                    : `Refresh (${formatSyncAge(lastSyncedAt)})`}
              </span>
            </button>
          )}

          <div className="tz-toolbar-group">
            <span className="tz-toolbar-label">Time zone</span>
            <TimeZoneSelect
              value={displayTimeZone}
              onValueChange={(tz) => {
                setDisplayTimeZone(tz);
                setOutputTimeZone(tz);
              }}
              options={timeZoneOptions}
              ariaLabel="Calendar and output time zone"
            />
          </div>

          <button
            type="button"
            className="btn btn-primary submit-btn"
            onClick={() => setOutputOpen(true)}
          >
            <Send size={14} />
            Submit
            {availabilityBlocks.length > 0 && (
              <span className="submit-badge">{availabilityBlocks.length}</span>
            )}
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className="status-banner" role="status">
          <span>{statusMessage}</span>
          <button
            type="button"
            className="status-dismiss"
            onClick={() => setStatusMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="workspace-body">
        <CalendarSidebar
          calendars={calendars}
          onToggleCalendar={handleToggleCalendar}
          onRemoveCalendar={handleRemoveCalendar}
          onOpenConnect={() => setConnectOpen(true)}
          onRefresh={handleRefreshAll}
          onLoadDemo={handleLoadDemo}
          isRefreshing={isRefreshing}
          availabilityCount={availabilityBlocks.length}
          onClearAvailability={() => setAvailabilityBlocks([])}
          showWeekends={showWeekends}
          onToggleWeekends={setShowWeekends}
          startOnMonday={startOnMonday}
          onToggleStartOnMonday={handleToggleStartOnMonday}
          blocks={availabilityBlocks}
        />

        <main className="main-calendar-pane">
          <WeekCalendarGrid
            weekStartDateStr={weekStartDateStr}
            displayTimeZone={displayTimeZone}
            showWeekends={showWeekends}
            calendars={calendars}
            events={allEvents}
            availabilityBlocks={availabilityBlocks}
            onAddAvailability={handleAddAvailability}
            onRemoveAvailability={handleRemoveAvailability}
          />
        </main>
      </div>

      <ConnectCalendarDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        savedClientId={savedClientId}
        onConnectGoogleOAuth={handleConnectGoogleOAuth}
        onAddIcalUrl={handleAddIcalUrl}
        onAddIcalFile={handleAddIcalFile}
      />

      <AvailabilityOutputDialog
        open={outputOpen}
        onOpenChange={setOutputOpen}
        blocks={availabilityBlocks}
        outputTimeZone={outputTimeZone}
        onChangeOutputTimeZone={setOutputTimeZone}
        timeZoneOptions={timeZoneOptions}
      />
    </div>
  );
}
export default App;
