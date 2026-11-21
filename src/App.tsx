import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Moon,
  RefreshCw,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  AvailabilityBlock,
  CalendarEvent,
  CalendarSource,
  CalendarViewMode,
  ParticipantAvailability,
} from './types';
import {
  computeFreeIntervalsForDay,
  getCurrentWeekStart,
  getLocalTimeZone,
  getTimeZoneOptions,
  getWeekDates,
  mergeAvailabilityBlocks,
  msToZonedDateAndMinutes,
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
import { CalendarSidebar, type HighlightColorId } from './components/CalendarSidebar';
import { WeekCalendarGrid } from './components/WeekCalendarGrid';
import { HeatmapCalendarGrid } from './components/HeatmapCalendarGrid';
import { ConnectCalendarDialog } from './components/ConnectCalendarDialog';
import { AvailabilityOutputDialog } from './components/AvailabilityOutputDialog';
import { AddParticipantDialog } from './components/AddParticipantDialog';
import { TimeZoneSelect } from './components/TimeZoneSelect';

const DEFAULT_GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';

const STORAGE_KEYS = {
  clientId: 'slotpicker_gcal_client_id',
  calendars: 'slotpicker_calendars_v1',
  googleEvents: 'slotpicker_gcal_events_v1',
  rawIcs: 'slotpicker_raw_ics_v1',
  availability: 'slotpicker_availability_v1',
  token: 'slotpicker_gcal_token_v1',
  tokenExpiresAt: 'slotpicker_gcal_token_exp_v1',
  lastSyncedAt: 'slotpicker_last_synced_v1',
  workHours: 'slotpicker_work_hours_v1',
  ignoredEvents: 'slotpicker_ignored_events_v1',
  darkMode: 'slotpicker_dark_mode_v1',
  highlightColor: 'slotpicker_highlight_color_v1',
  participants: 'slotpicker_participants_v1',
  includeMe: 'slotpicker_include_me_v1',
} as const;

const HIGHLIGHT_THEME_VARS: Record<
  HighlightColorId,
  { light: Record<string, string>; dark: Record<string, string> }
> = {
  emerald: {
    light: { '--avail-bg': 'rgba(16, 185, 129, 0.22)', '--avail-border': '#10b981', '--avail-text': '#065f46' },
    dark: { '--avail-bg': 'rgba(16, 185, 129, 0.26)', '--avail-border': '#34d399', '--avail-text': '#6ee7b7' },
  },
  blue: {
    light: { '--avail-bg': 'rgba(59, 130, 246, 0.20)', '--avail-border': '#3b82f6', '--avail-text': '#1e40af' },
    dark: { '--avail-bg': 'rgba(59, 130, 246, 0.28)', '--avail-border': '#60a5fa', '--avail-text': '#bfdbfe' },
  },
  violet: {
    light: { '--avail-bg': 'rgba(139, 92, 246, 0.20)', '--avail-border': '#8b5cf6', '--avail-text': '#5b21b6' },
    dark: { '--avail-bg': 'rgba(139, 92, 246, 0.28)', '--avail-border': '#a78bfa', '--avail-text': '#ddd6fe' },
  },
  amber: {
    light: { '--avail-bg': 'rgba(245, 158, 11, 0.22)', '--avail-border': '#f59e0b', '--avail-text': '#92400e' },
    dark: { '--avail-bg': 'rgba(245, 158, 11, 0.26)', '--avail-border': '#fbbf24', '--avail-text': '#fde68a' },
  },
  rose: {
    light: { '--avail-bg': 'rgba(244, 63, 94, 0.20)', '--avail-border': '#f43f5e', '--avail-text': '#9f1239' },
    dark: { '--avail-bg': 'rgba(244, 63, 94, 0.26)', '--avail-border': '#fb7185', '--avail-text': '#fecdd3' },
  },
};

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
    () => localStorage.getItem(STORAGE_KEYS.clientId) || DEFAULT_GOOGLE_CLIENT_ID
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.lastSyncedAt);
    return raw ? Number(raw) : null;
  });

  const [availabilityBlocks, setAvailabilityBlocks] = useState<AvailabilityBlock[]>(() =>
    readJsonStorage<AvailabilityBlock[]>(STORAGE_KEYS.availability, [])
  );
  const [ignoredEventList, setIgnoredEventList] = useState<string[]>(() =>
    readJsonStorage<string[]>(STORAGE_KEYS.ignoredEvents, [])
  );
  const ignoredEventIds = useMemo(() => new Set(ignoredEventList), [ignoredEventList]);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.darkMode);
    if (saved !== null) return saved === 'true';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });
  const [highlightColor, setHighlightColor] = useState<HighlightColorId>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.highlightColor) as HighlightColorId | null;
    return saved && saved in HIGHLIGHT_THEME_VARS ? saved : 'emerald';
  });
  const [workStartMin, setWorkStartMin] = useState<number>(() =>
    readJsonStorage<{ start: number; end: number }>(STORAGE_KEYS.workHours, {
      start: 9 * 60,
      end: 17 * 60,
    }).start
  );
  const [workEndMin, setWorkEndMin] = useState<number>(() =>
    readJsonStorage<{ start: number; end: number }>(STORAGE_KEYS.workHours, {
      start: 9 * 60,
      end: 17 * 60,
    }).end
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('edit');
  const [participants, setParticipants] = useState<ParticipantAvailability[]>(() =>
    readJsonStorage<ParticipantAvailability[]>(STORAGE_KEYS.participants, [])
  );
  const [includeMeInHeatmap, setIncludeMeInHeatmap] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.includeMe);
    return saved !== null ? saved === 'true' : true;
  });
  const [minOverlap, setMinOverlap] = useState<number>(2);
  const [participantDialogOpen, setParticipantDialogOpen] = useState(false);
  const [editingParticipant, setEditingParticipant] = useState<ParticipantAvailability | null>(
    null
  );
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ignoredEvents, JSON.stringify(ignoredEventList));
  }, [ignoredEventList]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEYS.darkMode, String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.highlightColor, highlightColor);
  }, [highlightColor]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.workHours,
      JSON.stringify({ start: workStartMin, end: workEndMin })
    );
  }, [workStartMin, workEndMin]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.participants, JSON.stringify(participants));
  }, [participants]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.includeMe, String(includeMeInHeatmap));
  }, [includeMeInHeatmap]);

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

  const handleChangeCalendarColor = (id: string, color: string) => {
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, color } : c))
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

  const handleToggleIgnoreEvent = (eventId: string) => {
    setIgnoredEventList((prev) =>
      prev.includes(eventId)
        ? prev.filter((id) => id !== eventId)
        : [...prev, eventId]
    );
  };

  const handleClearDay = (dateStr: string) => {
    const dayStartMs = zonedDateMinutesToMs(dateStr, 0, displayTimeZone);
    const dayEndMs = zonedDateMinutesToMs(dateStr, 24 * 60, displayTimeZone);

    setAvailabilityBlocks((prev) => {
      const next: AvailabilityBlock[] = [];
      for (const b of prev) {
        if (b.endMs <= dayStartMs || b.startMs >= dayEndMs) {
          next.push(b);
          continue;
        }
        if (b.startMs < dayStartMs) {
          next.push({ id: crypto.randomUUID(), startMs: b.startMs, endMs: dayStartMs });
        }
        if (b.endMs > dayEndMs) {
          next.push({ id: crypto.randomUUID(), startMs: dayEndMs, endMs: b.endMs });
        }
      }
      return next;
    });
  };

  const handleFillFreeDays = (dateStrs: string[]) => {
    const enabledCalIds = new Set(
      calendars.filter((c) => c.enabled).map((c) => c.id)
    );
    const enabledEvents = allEvents.filter(
      (ev) => enabledCalIds.has(ev.calendarId) && !ignoredEventIds.has(ev.id)
    );

    const newBlocks: AvailabilityBlock[] = [];
    for (const dateStr of dateStrs) {
      const intervals = computeFreeIntervalsForDay(
        dateStr,
        workStartMin,
        workEndMin,
        displayTimeZone,
        enabledEvents
      );
      for (const iv of intervals) {
        newBlocks.push({
          id: crypto.randomUUID(),
          startMs: iv.startMs,
          endMs: iv.endMs,
        });
      }
    }

    if (newBlocks.length === 0) {
      setStatusMessage('No free slots found within working hours for the selected day(s).');
      return;
    }

    setAvailabilityBlocks((prev) => mergeAvailabilityBlocks([...prev, ...newBlocks]));
  };

  const handleFillFreeWeekdays = () => {
    const weekdays = getWeekDates(weekStartDateStr).filter((d) => {
      const dow = Temporal.PlainDate.from(d).dayOfWeek;
      return dow >= 1 && dow <= 5;
    });
    handleFillFreeDays(weekdays);
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

  const handleOpenAddParticipant = () => {
    setEditingParticipant(null);
    setParticipantDialogOpen(true);
  };

  const handleEditParticipant = (participant: ParticipantAvailability) => {
    setEditingParticipant(participant);
    setParticipantDialogOpen(true);
  };

  const handleSaveParticipant = (data: {
    id?: string;
    name: string;
    color: string;
    rawText: string;
    defaultTimeZone: string;
    referenceWeekStart: string;
    blocks: AvailabilityBlock[];
  }) => {
    if (data.id) {
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === data.id
            ? {
                ...p,
                name: data.name,
                color: data.color,
                rawText: data.rawText,
                defaultTimeZone: data.defaultTimeZone,
                referenceWeekStart: data.referenceWeekStart,
                blocks: data.blocks,
                updatedAt: Date.now(),
              }
            : p
        )
      );
      setStatusMessage(`Updated ${data.name}'s availability (${data.blocks.length} blocks).`);
    } else {
      const nextParticipant: ParticipantAvailability = {
        id: `person:${crypto.randomUUID()}`,
        name: data.name,
        color: data.color,
        enabled: true,
        rawText: data.rawText,
        defaultTimeZone: data.defaultTimeZone,
        referenceWeekStart: data.referenceWeekStart,
        blocks: data.blocks,
        updatedAt: Date.now(),
      };
      const nextEnabledCount =
        (includeMeInHeatmap ? 1 : 0) +
        participants.filter((p) => p.enabled).length +
        1;
      setParticipants((prev) => [...prev, nextParticipant]);
      setMinOverlap(nextEnabledCount);
      setViewMode('heatmap');
      setStatusMessage(
        `Added ${data.name}'s availability (${data.blocks.length} blocks) — switched to Group Heatmap.`
      );
    }
  };

  const handleToggleParticipant = (id: string) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  };

  const handleJumpToParticipantWeek = (participant: ParticipantAvailability) => {
    if (participant.blocks.length === 0) return;
    const earliestMs = Math.min(...participant.blocks.map((b) => b.startMs));
    const { dateStr } = msToZonedDateAndMinutes(earliestMs, displayTimeZone);
    const pd = Temporal.PlainDate.from(dateStr);
    const offset = startOnMonday ? pd.dayOfWeek - 1 : pd.dayOfWeek % 7;
    setWeekStartDateStr(pd.subtract({ days: offset }).toString());
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

  const enabledGroupCount =
    (includeMeInHeatmap ? 1 : 0) + participants.filter((p) => p.enabled).length;

  const highlightVars = HIGHLIGHT_THEME_VARS[highlightColor][darkMode ? 'dark' : 'light'];

  return (
    <div className="app-shell" style={highlightVars as React.CSSProperties}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <span className="brand-icon">
              <Calendar size={18} />
            </span>
            <span className="brand-title">SlotPicker</span>
          </div>

          <div className="mode-switcher" role="tablist" aria-label="Calendar view mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'edit'}
              className={`mode-switch-btn ${viewMode === 'edit' ? 'is-active' : ''}`}
              onClick={() => setViewMode('edit')}
            >
              <Calendar size={13} />
              My Calendar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'heatmap'}
              className={`mode-switch-btn ${viewMode === 'heatmap' ? 'is-active' : ''}`}
              onClick={() => setViewMode('heatmap')}
            >
              <Users size={13} />
              Group Heatmap
              {participants.length > 0 && (
                <span className="mode-switch-badge">{enabledGroupCount}</span>
              )}
            </button>
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
          {isDemoOnly && viewMode === 'edit' && (
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

          {viewMode === 'edit' && availabilityBlocks.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAvailabilityBlocks([])}
              title="Clear all highlighted availability blocks"
            >
              <Trash2 size={13} />
              Clear All
            </button>
          )}

          <button
            type="button"
            className="icon-btn"
            onClick={() => setDarkMode((d) => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            type="button"
            className="btn btn-primary submit-btn"
            onClick={() => setOutputOpen(true)}
          >
            <Send size={14} />
            Submit
            {availabilityBlocks.length > 0 && viewMode === 'edit' && (
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
          onChangeCalendarColor={handleChangeCalendarColor}
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
          workStartMin={workStartMin}
          workEndMin={workEndMin}
          onChangeWorkStart={setWorkStartMin}
          onChangeWorkEnd={setWorkEndMin}
          onFillFreeWeekdays={handleFillFreeWeekdays}
          darkMode={darkMode}
          onToggleDarkMode={setDarkMode}
          highlightColor={highlightColor}
          onChangeHighlightColor={setHighlightColor}
          participants={participants}
          includeMeInHeatmap={includeMeInHeatmap}
          onToggleIncludeMe={setIncludeMeInHeatmap}
          onOpenAddParticipant={handleOpenAddParticipant}
          onEditParticipant={handleEditParticipant}
          onToggleParticipant={handleToggleParticipant}
          onRemoveParticipant={handleRemoveParticipant}
          onJumpToParticipantWeek={handleJumpToParticipantWeek}
          weekStartMs={weekWindow.startMs}
          weekEndMs={weekWindow.endMs}
        />

        <main className="main-calendar-pane">
          {viewMode === 'edit' ? (
            <WeekCalendarGrid
              weekStartDateStr={weekStartDateStr}
              displayTimeZone={displayTimeZone}
              showWeekends={showWeekends}
              calendars={calendars}
              events={allEvents}
              availabilityBlocks={availabilityBlocks}
              ignoredEventIds={ignoredEventIds}
              workStartMin={workStartMin}
              workEndMin={workEndMin}
              onAddAvailability={handleAddAvailability}
              onRemoveAvailability={handleRemoveAvailability}
              onFillFreeDay={(dateStr) => handleFillFreeDays([dateStr])}
              onClearDay={handleClearDay}
              onToggleIgnoreEvent={handleToggleIgnoreEvent}
            />
          ) : (
            <HeatmapCalendarGrid
              weekStartDateStr={weekStartDateStr}
              displayTimeZone={displayTimeZone}
              showWeekends={showWeekends}
              workStartMin={workStartMin}
              workEndMin={workEndMin}
              myBlocks={availabilityBlocks}
              includeMe={includeMeInHeatmap}
              participants={participants}
              minOverlap={minOverlap}
              onChangeMinOverlap={setMinOverlap}
              onOpenAddParticipant={handleOpenAddParticipant}
              calendars={calendars}
              events={allEvents}
              ignoredEventIds={ignoredEventIds}
            />
          )}
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

      <AddParticipantDialog
        open={participantDialogOpen}
        onOpenChange={setParticipantDialogOpen}
        editingParticipant={editingParticipant}
        defaultTimeZone={displayTimeZone}
        displayTimeZone={displayTimeZone}
        currentWeekStart={weekStartDateStr}
        timeZoneOptions={timeZoneOptions}
        existingCount={participants.length}
        onSave={handleSaveParticipant}
      />

      <AvailabilityOutputDialog
        open={outputOpen}
        onOpenChange={setOutputOpen}
        blocks={availabilityBlocks}
        includeMeInHeatmap={includeMeInHeatmap}
        participants={participants}
        defaultSource={viewMode === 'heatmap' && participants.length > 0 ? 'shared' : 'mine'}
        defaultMinOverlap={minOverlap}
        outputTimeZone={outputTimeZone}
        onChangeOutputTimeZone={setOutputTimeZone}
        timeZoneOptions={timeZoneOptions}
      />
    </div>
  );
}
export default App;
