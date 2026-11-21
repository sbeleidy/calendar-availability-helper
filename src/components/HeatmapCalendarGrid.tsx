import { useMemo, useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Check, Plus, Sparkles, Users, X } from 'lucide-react';
import type {
  AvailabilityBlock,
  CalendarEvent,
  CalendarSource,
  HeatmapSegment,
  ParticipantAvailability,
} from '../types';
import { computeHeatmapSegments } from '../utils/sharedAvailability';
import {
  formatMinutesLabel,
  getWeekDates,
  msToZonedDateAndMinutes,
  zonedDateMinutesToMs,
} from '../utils/temporal';

const GRID_START_HOUR = 6;
const GRID_END_HOUR = 22;
const TOTAL_HOURS = GRID_END_HOUR - GRID_START_HOUR;
const HOUR_HEIGHT = 56;

interface HeatmapCalendarGridProps {
  weekStartDateStr: string;
  displayTimeZone: string;
  showWeekends: boolean;
  workStartMin: number;
  workEndMin: number;
  myBlocks: AvailabilityBlock[];
  includeMe: boolean;
  participants: ParticipantAvailability[];
  minOverlap: number;
  onChangeMinOverlap: (val: number) => void;
  onOpenAddParticipant: () => void;
  calendars: CalendarSource[];
  events: CalendarEvent[];
  ignoredEventIds: Set<string>;
}

interface DayHeatmapSegment {
  segment: HeatmapSegment;
  startMin: number;
  endMin: number;
}

export function HeatmapCalendarGrid({
  weekStartDateStr,
  displayTimeZone,
  showWeekends,
  workStartMin,
  workEndMin,
  myBlocks,
  includeMe,
  participants,
  minOverlap,
  onChangeMinOverlap,
  onOpenAddParticipant,
  calendars,
  events,
  ignoredEventIds,
}: HeatmapCalendarGridProps) {
  const [showMyEvents, setShowMyEvents] = useState(false);

  const visibleDays = useMemo(() => {
    const allDays = getWeekDates(weekStartDateStr);
    if (showWeekends) return allDays;
    return allDays.filter((d) => {
      const dow = Temporal.PlainDate.from(d).dayOfWeek;
      return dow !== 6 && dow !== 7;
    });
  }, [weekStartDateStr, showWeekends]);

  const todayStr = useMemo(
    () => Temporal.Now.plainDateISO(displayTimeZone).toString(),
    [displayTimeZone]
  );

  const nowMinutes = useMemo(() => {
    const now = Temporal.Now.zonedDateTimeISO(displayTimeZone);
    return now.hour * 60 + now.minute;
  }, [displayTimeZone]);

  const allGroupParticipants = useMemo(() => {
    return [
      { id: '__me__', name: 'Me', color: 'var(--avail-border)', enabled: includeMe, blocks: myBlocks },
      ...participants.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        enabled: p.enabled,
        blocks: p.blocks,
      })),
    ];
  }, [includeMe, myBlocks, participants]);

  const enabledCount = useMemo(
    () => allGroupParticipants.filter((p) => p.enabled).length,
    [allGroupParticipants]
  );

  const participantNameMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const p of allGroupParticipants) {
      map.set(p.id, { name: p.name, color: p.color });
    }
    return map;
  }, [allGroupParticipants]);

  // Clamp effective minOverlap to [1, max(1, enabledCount)]
  const effectiveMinOverlap = Math.max(1, Math.min(minOverlap, Math.max(1, enabledCount)));

  const segmentsByDay = useMemo(() => {
    const map = new Map<string, DayHeatmapSegment[]>();
    if (visibleDays.length === 0) return map;

    const rangeStartMs = zonedDateMinutesToMs(visibleDays[0], 0, displayTimeZone);
    const rangeEndMs = zonedDateMinutesToMs(
      visibleDays[visibleDays.length - 1],
      24 * 60,
      displayTimeZone
    );
    const segments = computeHeatmapSegments(allGroupParticipants, rangeStartMs, rangeEndMs);

    for (const dayStr of visibleDays) {
      const dayStartMs = zonedDateMinutesToMs(dayStr, 0, displayTimeZone);
      const dayEndMs = zonedDateMinutesToMs(dayStr, 24 * 60, displayTimeZone);
      const list: DayHeatmapSegment[] = [];

      for (const seg of segments) {
        if (seg.endMs <= dayStartMs || seg.startMs >= dayEndMs) continue;

        const startZ = msToZonedDateAndMinutes(Math.max(seg.startMs, dayStartMs), displayTimeZone);
        const endZ = msToZonedDateAndMinutes(Math.min(seg.endMs, dayEndMs), displayTimeZone);
        const startMin = startZ.dateStr === dayStr ? startZ.minutes : 0;
        const endMin = endZ.dateStr === dayStr ? endZ.minutes : 24 * 60;

        const clampedStart = Math.max(GRID_START_HOUR * 60, startMin);
        const clampedEnd = Math.min(GRID_END_HOUR * 60, endMin);
        if (clampedEnd <= clampedStart) continue;

        list.push({ segment: seg, startMin: clampedStart, endMin: clampedEnd });
      }

      map.set(dayStr, list);
    }

    return map;
  }, [allGroupParticipants, visibleDays, displayTimeZone]);

  // Optional subtle overlay of user's own busy events
  const busyEventsByDay = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string; startMin: number; endMin: number; color: string }>>();
    if (!showMyEvents) return map;

    const enabledCalMap = new Map<string, CalendarSource>();
    for (const c of calendars) {
      if (c.enabled) enabledCalMap.set(c.id, c);
    }

    for (const ev of events) {
      if (ev.allDay || ignoredEventIds.has(ev.id)) continue;
      const cal = enabledCalMap.get(ev.calendarId);
      if (!cal) continue;

      const startZ = msToZonedDateAndMinutes(ev.startMs, displayTimeZone);
      const endZ = msToZonedDateAndMinutes(ev.endMs, displayTimeZone);

      for (const dayStr of visibleDays) {
        const dayStartMs = zonedDateMinutesToMs(dayStr, 0, displayTimeZone);
        const dayEndMs = zonedDateMinutesToMs(dayStr, 24 * 60, displayTimeZone);
        if (ev.endMs <= dayStartMs || ev.startMs >= dayEndMs) continue;

        const startMin = startZ.dateStr === dayStr ? startZ.minutes : 0;
        const endMin = endZ.dateStr === dayStr ? endZ.minutes : 24 * 60;
        const clampedStart = Math.max(GRID_START_HOUR * 60, startMin);
        const clampedEnd = Math.min(GRID_END_HOUR * 60, endMin);
        if (clampedEnd <= clampedStart) continue;

        const arr = map.get(dayStr) ?? [];
        arr.push({ id: ev.id, title: ev.title, startMin: clampedStart, endMin: clampedEnd, color: cal.color });
        map.set(dayStr, arr);
      }
    }
    return map;
  }, [showMyEvents, calendars, events, ignoredEventIds, displayTimeZone, visibleDays]);

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => GRID_START_HOUR + i);
  const gridHeight = TOTAL_HOURS * HOUR_HEIGHT;

  const filterThresholds = useMemo(() => {
    if (enabledCount <= 1) return [1];
    const thresholds: number[] = [];
    for (let k = enabledCount; k >= 1; k--) {
      thresholds.push(k);
    }
    return thresholds;
  }, [enabledCount]);

  return (
    <div className="calendar-grid-shell heatmap-grid-shell">
      {/* Heatmap Legend & Filter Toolbar */}
      <div className="heatmap-toolbar">
        <div className="heatmap-legend">
          <span className="heatmap-toolbar-label">Overlap</span>
          <div className="heatmap-ramp" aria-label="Availability overlap intensity legend">
            {Array.from({ length: Math.max(1, enabledCount) + 1 }, (_, k) => {
              const ratio = enabledCount > 0 ? k / enabledCount : 0;
              return (
                <span
                  key={k}
                  className={`heatmap-ramp-cell ${k === enabledCount && enabledCount >= 2 ? 'is-full' : ''}`}
                  style={{ '--heat-alpha': k === 0 ? 0 : 0.14 + ratio * 0.62 } as React.CSSProperties}
                  title={`${k} of ${enabledCount} available`}
                >
                  {k}
                </span>
              );
            })}
          </div>
          <span className="heatmap-legend-total">of {enabledCount}</span>
        </div>

        <div className="heatmap-toolbar-controls">
          {enabledCount >= 2 && (
            <div className="heatmap-filter-group" role="group" aria-label="Minimum overlap filter">
              <span className="heatmap-toolbar-label">Highlight</span>
              {filterThresholds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`heatmap-filter-pill ${effectiveMinOverlap === k ? 'is-active' : ''}`}
                  onClick={() => onChangeMinOverlap(k)}
                >
                  {k === enabledCount ? `All (${k}/${enabledCount})` : k === 1 ? 'Any' : `≥ ${k}`}
                </button>
              ))}
            </div>
          )}

          <label className="heatmap-events-toggle">
            <span>My events</span>
            <Switch.Root
              checked={showMyEvents}
              onCheckedChange={setShowMyEvents}
              className="base-switch"
              aria-label="Show my busy calendar events on heatmap"
            >
              <Switch.Thumb className="base-switch-thumb" />
            </Switch.Root>
          </label>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onOpenAddParticipant}
          >
            <Plus size={13} />
            Paste Availability
          </button>
        </div>
      </div>

      {/* Day Headers */}
      <div
        className="calendar-header-row"
        style={{
          gridTemplateColumns: `64px repeat(${visibleDays.length}, minmax(0, 1fr))`,
        }}
      >
        <div className="time-gutter-header">
          <span className="tz-badge-mini" title={displayTimeZone}>
            {displayTimeZone.split('/').pop()?.replace(/_/g, ' ')}
          </span>
        </div>
        {visibleDays.map((dayStr) => {
          const pd = Temporal.PlainDate.from(dayStr);
          const zdt = pd.toZonedDateTime({ timeZone: displayTimeZone, plainTime: '12:00' });
          const weekday = zdt.toLocaleString('en-US', { weekday: 'short' });
          const isToday = dayStr === todayStr;

          const daySegs = segmentsByDay.get(dayStr) ?? [];
          const hasFullMatch =
            enabledCount >= 2 && daySegs.some((s) => s.segment.count >= effectiveMinOverlap);

          return (
            <div key={dayStr} className={`day-header-cell ${isToday ? 'is-today' : ''}`}>
              <span className="day-weekday">{weekday}</span>
              <span className="day-number">{pd.day}</span>
              {hasFullMatch && (
                <span className="heatmap-day-match-badge">
                  <Sparkles size={10} />
                  Match
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Scrollable Heatmap Grid */}
      <div className="calendar-scroll-area heatmap-scroll-area">
        {participants.length === 0 && (
          <div className="heatmap-empty-banner">
            <Users size={18} />
            <div>
              <strong>Compare availability like When2meet</strong>
              <p>Paste someone else&apos;s available times to see where everyone overlaps.</p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onOpenAddParticipant}
            >
              <Plus size={14} />
              Paste Availability
            </button>
          </div>
        )}

        <div
          className="calendar-time-grid"
          style={{
            gridTemplateColumns: `64px repeat(${visibleDays.length}, minmax(0, 1fr))`,
            height: `${gridHeight}px`,
          }}
        >
          {/* Time Labels Gutter */}
          <div className="time-gutter">
            {hours.map((h) => (
              <div key={h} className="time-gutter-slot" style={{ height: `${HOUR_HEIGHT}px` }}>
                <span>{formatMinutesLabel(h * 60)}</span>
              </div>
            ))}
          </div>

          {/* Day Columns */}
          {visibleDays.map((dayStr, dayIdx) => {
            const daySegs = segmentsByDay.get(dayStr) ?? [];
            const dayBusy = busyEventsByDay.get(dayStr) ?? [];
            const isToday = dayStr === todayStr;
            const alignRight = dayIdx >= visibleDays.length - 2;

            return (
              <div
                key={dayStr}
                className={`day-column heatmap-day-column ${isToday ? 'is-today' : ''}`}
              >
                {/* Hour Grid Lines */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="hour-cell-bg"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  />
                ))}

                {/* Non-working hours shading */}
                {workStartMin > GRID_START_HOUR * 60 && (
                  <div
                    className="non-working-band"
                    style={{
                      top: 0,
                      height: `${((workStartMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT}px`,
                    }}
                  />
                )}
                {workEndMin < GRID_END_HOUR * 60 && (
                  <div
                    className="non-working-band"
                    style={{
                      top: `${((workEndMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT}px`,
                      height: `${((GRID_END_HOUR * 60 - workEndMin) / 60) * HOUR_HEIGHT}px`,
                    }}
                  />
                )}

                {/* Current Time Line */}
                {isToday &&
                  nowMinutes >= GRID_START_HOUR * 60 &&
                  nowMinutes <= GRID_END_HOUR * 60 && (
                    <div
                      className="now-line"
                      style={{
                        top: `${((nowMinutes - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT}px`,
                      }}
                    >
                      <span className="now-dot" />
                    </div>
                  )}

                {/* Optional subtle user busy events */}
                {dayBusy.map((ev) => {
                  const top = ((ev.startMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(16, ((ev.endMin - ev.startMin) / 60) * HOUR_HEIGHT);
                  return (
                    <div
                      key={ev.id}
                      className="heatmap-busy-ghost"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        borderInlineStartColor: ev.color,
                      }}
                      title={`Busy: ${ev.title}`}
                    >
                      <span>{ev.title}</span>
                    </div>
                  );
                })}

                {/* Heatmap Overlap Segments */}
                {daySegs.map(({ segment, startMin, endMin }) => {
                  const top = ((startMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(14, ((endMin - startMin) / 60) * HOUR_HEIGHT);
                  const ratio = segment.total > 0 ? segment.count / segment.total : 0;
                  const alpha = 0.14 + ratio * 0.62;
                  const isFullOverlap = segment.total >= 2 && segment.count === segment.total;
                  const isDimmed = segment.count < effectiveMinOverlap;

                  return (
                    <div
                      key={`${segment.startMs}-${segment.endMs}`}
                      tabIndex={0}
                      className={`heatmap-segment ${isFullOverlap ? 'is-full-overlap' : ''} ${isDimmed ? 'is-dimmed' : ''}`}
                      style={
                        {
                          top: `${top}px`,
                          height: `${height}px`,
                          '--heat-alpha': alpha,
                        } as React.CSSProperties
                      }
                    >
                      {height >= 24 && (
                        <div className="heatmap-segment-label">
                          <span className="heatmap-segment-ratio">
                            {segment.count}/{segment.total}
                          </span>
                          {height >= 38 && (
                            <span className="heatmap-segment-time">
                              {formatMinutesLabel(startMin)} – {formatMinutesLabel(endMin)}
                            </span>
                          )}
                        </div>
                      )}

                      <div
                        className={`heatmap-hover-card ${alignRight ? 'align-right' : ''}`}
                        role="tooltip"
                      >
                        <div className="heatmap-hover-header">
                          <span className="heatmap-hover-time">
                            {formatMinutesLabel(startMin)} – {formatMinutesLabel(endMin)}
                          </span>
                          <span className="heatmap-hover-count">
                            {segment.count} of {segment.total} available
                          </span>
                        </div>

                        <div className="heatmap-hover-section">
                          <div className="heatmap-hover-section-label">Available</div>
                          <ul className="heatmap-hover-people">
                            {segment.availableIds.map((id) => {
                              const info = participantNameMap.get(id);
                              return (
                                <li key={id} className="is-available">
                                  <Check size={12} />
                                  <span>{info?.name ?? id}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>

                        {segment.unavailableIds.length > 0 && (
                          <div className="heatmap-hover-section">
                            <div className="heatmap-hover-section-label">Unavailable</div>
                            <ul className="heatmap-hover-people">
                              {segment.unavailableIds.map((id) => {
                                const info = participantNameMap.get(id);
                                return (
                                  <li key={id} className="is-unavailable">
                                    <X size={12} />
                                    <span>{info?.name ?? id}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
