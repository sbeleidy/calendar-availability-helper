import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, MapPin, Trash2, Wand2, X } from 'lucide-react';
import type { AvailabilityBlock, CalendarEvent, CalendarSource } from '../types';
import {
  formatMinutesLabel,
  getWeekDates,
  msToZonedDateAndMinutes,
  zonedDateMinutesToMs,
} from '../utils/temporal';

const GRID_START_HOUR = 6; // 6:00 AM
const GRID_END_HOUR = 22; // 10:00 PM
const TOTAL_HOURS = GRID_END_HOUR - GRID_START_HOUR;
const HOUR_HEIGHT = 56; // px per hour
const SNAP_MINUTES = 15;

interface WeekCalendarGridProps {
  weekStartDateStr: string;
  displayTimeZone: string;
  showWeekends: boolean;
  calendars: CalendarSource[];
  events: CalendarEvent[];
  availabilityBlocks: AvailabilityBlock[];
  ignoredEventIds: Set<string>;
  workStartMin: number;
  workEndMin: number;
  onAddAvailability: (startMs: number, endMs: number) => void;
  onRemoveAvailability: (id: string) => void;
  onFillFreeDay: (dateStr: string) => void;
  onClearDay: (dateStr: string) => void;
  onToggleIgnoreEvent: (eventId: string) => void;
}

interface PositionedEvent {
  event: CalendarEvent;
  color: string;
  startMin: number;
  endMin: number;
  col: number;
  totalCols: number;
}

interface DragState {
  dateStr: string;
  anchorMin: number;
  currentMin: number;
}

function layoutOverlappingEvents(
  dayEvents: Array<{ event: CalendarEvent; color: string; startMin: number; endMin: number }>
): PositionedEvent[] {
  if (dayEvents.length === 0) return [];
  const sorted = [...dayEvents].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin
  );

  // Group into connected overlap clusters
  const clusters: Array<typeof sorted> = [];
  let currentCluster: typeof sorted = [];
  let clusterEnd = -1;

  for (const item of sorted) {
    if (currentCluster.length === 0 || item.startMin < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.endMin;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const positioned: PositionedEvent[] = [];

  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const assigned: Array<{ item: (typeof sorted)[0]; col: number }> = [];

    for (const item of cluster) {
      let col = colEnds.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(item.endMin);
      } else {
        colEnds[col] = item.endMin;
      }
      assigned.push({ item, col });
    }

    const totalCols = Math.max(1, colEnds.length);
    for (const { item, col } of assigned) {
      positioned.push({
        ...item,
        col,
        totalCols,
      });
    }
  }

  return positioned;
}

export function WeekCalendarGrid({
  weekStartDateStr,
  displayTimeZone,
  showWeekends,
  calendars,
  events,
  availabilityBlocks,
  ignoredEventIds,
  workStartMin,
  workEndMin,
  onAddAvailability,
  onRemoveAvailability,
  onFillFreeDay,
  onClearDay,
  onToggleIgnoreEvent,
}: WeekCalendarGridProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const gridBodyRef = useRef<HTMLDivElement | null>(null);

  const calendarMap = useMemo(() => {
    const m = new Map<string, CalendarSource>();
    for (const c of calendars) m.set(c.id, c);
    return m;
  }, [calendars]);

  const visibleDays = useMemo(() => {
    const allDays = getWeekDates(weekStartDateStr);
    if (showWeekends) return allDays;
    return allDays.filter((d) => {
      const dow = Temporal.PlainDate.from(d).dayOfWeek; // 6=Sat, 7=Sun
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

  // Group events by day in displayTimeZone
  const eventsByDay = useMemo(() => {
    const map = new Map<string, PositionedEvent[]>();
    const rawByDay = new Map<
      string,
      Array<{ event: CalendarEvent; color: string; startMin: number; endMin: number }>
    >();
    const allDayByDay = new Map<string, Array<{ event: CalendarEvent; color: string }>>();

    for (const ev of events) {
      const cal = calendarMap.get(ev.calendarId);
      if (!cal || !cal.enabled) continue;

      if (ev.allDay) {
        const startZ = msToZonedDateAndMinutes(ev.startMs, displayTimeZone);
        const arr = allDayByDay.get(startZ.dateStr) ?? [];
        arr.push({ event: ev, color: cal.color });
        allDayByDay.set(startZ.dateStr, arr);
        continue;
      }

      const startZ = msToZonedDateAndMinutes(ev.startMs, displayTimeZone);
      const endZ = msToZonedDateAndMinutes(ev.endMs, displayTimeZone);

      // Handle same-day and multi-day events within visible days
      for (const dayStr of visibleDays) {
        const dayStartMs = zonedDateMinutesToMs(dayStr, 0, displayTimeZone);
        const dayEndMs = zonedDateMinutesToMs(dayStr, 24 * 60, displayTimeZone);
        if (ev.endMs <= dayStartMs || ev.startMs >= dayEndMs) continue;

        const startMin =
          startZ.dateStr === dayStr ? startZ.minutes : 0;
        const endMin =
          endZ.dateStr === dayStr ? endZ.minutes : 24 * 60;

        const clampedStart = Math.max(GRID_START_HOUR * 60, startMin);
        const clampedEnd = Math.min(GRID_END_HOUR * 60, endMin);
        if (clampedEnd <= clampedStart) continue;

        const arr = rawByDay.get(dayStr) ?? [];
        arr.push({
          event: ev,
          color: cal.color,
          startMin: clampedStart,
          endMin: Math.max(clampedStart + 15, clampedEnd),
        });
        rawByDay.set(dayStr, arr);
      }
    }

    for (const dayStr of visibleDays) {
      map.set(dayStr, layoutOverlappingEvents(rawByDay.get(dayStr) ?? []));
    }

    return { timed: map, allDay: allDayByDay };
  }, [events, calendarMap, displayTimeZone, visibleDays]);

  // Project availability blocks onto each visible day
  const availabilityByDay = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        block: AvailabilityBlock;
        startMin: number;
        endMin: number;
        hasConflict: boolean;
      }>
    >();

    for (const dayStr of visibleDays) {
      const dayStartMs = zonedDateMinutesToMs(dayStr, 0, displayTimeZone);
      const dayEndMs = zonedDateMinutesToMs(dayStr, 24 * 60, displayTimeZone);
      const dayEvents = eventsByDay.timed.get(dayStr) ?? [];
      const list: Array<{
        block: AvailabilityBlock;
        startMin: number;
        endMin: number;
        hasConflict: boolean;
      }> = [];

      for (const block of availabilityBlocks) {
        if (block.endMs <= dayStartMs || block.startMs >= dayEndMs) continue;

        const startZ = msToZonedDateAndMinutes(
          Math.max(block.startMs, dayStartMs),
          displayTimeZone
        );
        const endZ = msToZonedDateAndMinutes(
          Math.min(block.endMs, dayEndMs),
          displayTimeZone
        );
        const startMin = startZ.dateStr === dayStr ? startZ.minutes : 0;
        const endMin = endZ.dateStr === dayStr ? endZ.minutes : 24 * 60;

        const clampedStart = Math.max(GRID_START_HOUR * 60, startMin);
        const clampedEnd = Math.min(GRID_END_HOUR * 60, endMin);
        if (clampedEnd <= clampedStart) continue;

        const hasConflict = dayEvents.some(
          (pe) =>
            !ignoredEventIds.has(pe.event.id) &&
            pe.event.startMs < block.endMs &&
            pe.event.endMs > block.startMs
        );

        list.push({
          block,
          startMin: clampedStart,
          endMin: clampedEnd,
          hasConflict,
        });
      }

      map.set(dayStr, list);
    }

    return map;
  }, [availabilityBlocks, visibleDays, displayTimeZone, eventsByDay.timed]);

  const yToMinutes = (clientY: number, colEl: HTMLElement): number => {
    const rect = colEl.getBoundingClientRect();
    const relY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const rawMinutes = GRID_START_HOUR * 60 + (relY / HOUR_HEIGHT) * 60;
    const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.max(GRID_START_HOUR * 60, Math.min(GRID_END_HOUR * 60, snapped));
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    dateStr: string
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-avail-remove], [data-event-ignore]')) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    const min = yToMinutes(e.clientY, e.currentTarget);
    setDrag({ dateStr, anchorMin: min, currentMin: min });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const min = yToMinutes(e.clientY, e.currentTarget);
    if (min !== drag.currentMin) {
      setDrag((prev) => (prev ? { ...prev, currentMin: min } : null));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    let startMin = Math.min(drag.anchorMin, drag.currentMin);
    let endMin = Math.max(drag.anchorMin, drag.currentMin);

    // Single click creates a convenient 30-minute slot
    if (endMin - startMin < SNAP_MINUTES) {
      endMin = Math.min(GRID_END_HOUR * 60, startMin + 30);
      if (endMin - startMin < SNAP_MINUTES) {
        startMin = Math.max(GRID_START_HOUR * 60, endMin - 30);
      }
    }

    const startMs = zonedDateMinutesToMs(drag.dateStr, startMin, displayTimeZone);
    const endMs = zonedDateMinutesToMs(drag.dateStr, endMin, displayTimeZone);
    onAddAvailability(startMs, endMs);
    setDrag(null);
  };

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => GRID_START_HOUR + i);
  const gridHeight = TOTAL_HOURS * HOUR_HEIGHT;

  const hasAnyAllDay = visibleDays.some(
    (d) => (eventsByDay.allDay.get(d)?.length ?? 0) > 0
  );

  return (
    <div className="calendar-grid-shell">
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

          const hasDayAvailability = (availabilityByDay.get(dayStr)?.length ?? 0) > 0;

          return (
            <div key={dayStr} className={`day-header-cell ${isToday ? 'is-today' : ''}`}>
              <span className="day-weekday">{weekday}</span>
              <span className="day-number">{pd.day}</span>
              <div className="day-header-actions">
                <button
                  type="button"
                  className="day-fill-free-btn"
                  onClick={() => onFillFreeDay(dayStr)}
                  title={`Select all meeting-free times on ${weekday} ${pd.day} within working hours`}
                >
                  <Wand2 size={11} />
                  Free
                </button>
                {hasDayAvailability && (
                  <button
                    type="button"
                    className="day-clear-btn"
                    onClick={() => onClearDay(dayStr)}
                    title={`Clear highlighted times on ${weekday} ${pd.day}`}
                  >
                    <Trash2 size={11} />
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day events strip (if any) */}
      {hasAnyAllDay && (
        <div
          className="all-day-row"
          style={{
            gridTemplateColumns: `64px repeat(${visibleDays.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="all-day-label">All day</div>
          {visibleDays.map((dayStr) => {
            const list = eventsByDay.allDay.get(dayStr) ?? [];
            return (
              <div key={dayStr} className="all-day-cell">
                {list.map(({ event, color }) => (
                  <div
                    key={event.id}
                    className="all-day-pill"
                    style={{ backgroundColor: `${color}22`, borderColor: color, color }}
                    title={event.title}
                  >
                    {event.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Scrollable Time Grid */}
      <div className="calendar-scroll-area" ref={gridBodyRef}>
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
            const dayEvents = eventsByDay.timed.get(dayStr) ?? [];
            const dayAvail = availabilityByDay.get(dayStr) ?? [];
            const isToday = dayStr === todayStr;
            const isDraggingHere = drag?.dateStr === dayStr;

            const dragStartMin = isDraggingHere
              ? Math.min(drag.anchorMin, drag.currentMin)
              : 0;
            const dragEndMin = isDraggingHere
              ? Math.max(drag.anchorMin, drag.currentMin)
              : 0;

            return (
              <div
                key={dayStr}
                className={`day-column ${isToday ? 'is-today' : ''}`}
                onPointerDown={(e) => handlePointerDown(e, dayStr)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                {/* Hour & Half-Hour Grid Lines */}
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

                {/* Busy Events from Calendars */}
                {dayEvents.map((pe) => {
                  const top =
                    ((pe.startMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(
                    18,
                    ((pe.endMin - pe.startMin) / 60) * HOUR_HEIGHT
                  );
                  const widthPct = 100 / pe.totalCols;
                  const leftPct = pe.col * widthPct;
                  const isIgnored = ignoredEventIds.has(pe.event.id);
                  const calName = calendarMap.get(pe.event.calendarId)?.name ?? 'Calendar';
                  const alignRight = dayIdx >= visibleDays.length - 2;

                  return (
                    <div
                      key={pe.event.id}
                      className={`busy-event-card ${isIgnored ? 'is-ignored' : ''}`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        '--ev-color': pe.color,
                      } as React.CSSProperties}
                    >
                      <div className="busy-event-inner">
                        <div className="busy-event-title">{pe.event.title}</div>
                        {height >= 34 && (
                          <div className="busy-event-time">
                            {formatMinutesLabel(pe.startMin)} – {formatMinutesLabel(pe.endMin)}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        data-event-ignore
                        className="event-ignore-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleIgnoreEvent(pe.event.id);
                        }}
                        title={
                          isIgnored
                            ? 'Include this event when selecting free times'
                            : 'Ignore this event when selecting free times'
                        }
                        aria-label={
                          isIgnored
                            ? `Include ${pe.event.title}`
                            : `Ignore ${pe.event.title}`
                        }
                      >
                        {isIgnored ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>

                      <div
                        className={`event-hover-card ${alignRight ? 'align-right' : ''}`}
                        role="tooltip"
                      >
                        <div className="event-hover-title">{pe.event.title}</div>
                        <div className="event-hover-time">
                          {formatMinutesLabel(pe.startMin)} – {formatMinutesLabel(pe.endMin)}
                        </div>
                        <div className="event-hover-cal">
                          <span
                            className="event-hover-dot"
                            style={{ backgroundColor: pe.color }}
                          />
                          <span>{calName}</span>
                        </div>
                        {pe.event.location && (
                          <div className="event-hover-location">
                            <MapPin size={11} />
                            <span>{pe.event.location}</span>
                          </div>
                        )}
                        <div className="event-hover-status">
                          {isIgnored
                            ? 'Ignored — treated as free time'
                            : 'Click eye icon to ignore when selecting'}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Highlighted Availability Blocks */}
                {dayAvail.map(({ block, startMin, endMin, hasConflict }) => {
                  const top =
                    ((startMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max(
                    18,
                    ((endMin - startMin) / 60) * HOUR_HEIGHT
                  );

                  return (
                    <div
                      key={block.id}
                      className={`avail-block ${hasConflict ? 'has-conflict' : ''}`}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                      }}
                    >
                      <div className="avail-block-content">
                        <span className="avail-block-time">
                          {formatMinutesLabel(startMin)} – {formatMinutesLabel(endMin)}
                        </span>
                        {hasConflict && height >= 36 && (
                          <span className="avail-conflict-tag">
                            <AlertTriangle size={11} />
                            Overlaps busy event
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        data-avail-remove
                        className="avail-remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAvailability(block.id);
                        }}
                        title="Remove availability block"
                        aria-label="Remove availability block"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}

                {/* Live Drag Selection Preview */}
                {isDraggingHere && (
                  <div
                    className="avail-drag-preview"
                    style={{
                      top: `${((dragStartMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT}px`,
                      height: `${Math.max(
                        (SNAP_MINUTES / 60) * HOUR_HEIGHT,
                        ((dragEndMin - dragStartMin) / 60) * HOUR_HEIGHT
                      )}px`,
                    }}
                  >
                    <span>
                      {formatMinutesLabel(dragStartMin)} –{' '}
                      {formatMinutesLabel(
                        dragEndMin - dragStartMin < SNAP_MINUTES
                          ? Math.min(GRID_END_HOUR * 60, dragStartMin + 30)
                          : dragEndMin
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
