import type { Temporal as TemporalType } from 'temporal-polyfill';
import type { AvailabilityBlock, BulletFormat, CalendarEvent } from '../types';

/**
 * Ensure globalThis.Temporal is available, dynamically loading temporal-polyfill
 * only when native Temporal support is missing.
 */
export async function ensureTemporal(): Promise<void> {
  if (typeof globalThis.Temporal === 'undefined') {
    const mod = await import('temporal-polyfill');
    (globalThis as unknown as { Temporal: typeof mod.Temporal }).Temporal = mod.Temporal;
  }
}

export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

export interface TimeZoneOption {
  id: string;
  label: string;
}

const CURATED_TIMEZONES: string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export function getTimeZoneOptions(): TimeZoneOption[] {
  const local = getLocalTimeZone();
  const seen = new Set<string>();
  const list: string[] = [];

  if (local) {
    seen.add(local);
    list.push(local);
  }
  for (const tz of CURATED_TIMEZONES) {
    if (!seen.has(tz)) {
      seen.add(tz);
      list.push(tz);
    }
  }

  return list.map((id) => ({
    id,
    label: formatTimeZoneLabel(id, id === local),
  }));
}

export function formatTimeZoneLabel(timeZone: string, isLocal = false): string {
  try {
    const now = Temporal.Now.zonedDateTimeISO(timeZone);
    const offset = now.offset; // e.g. "-05:00"
    const city = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone;
    const suffix = isLocal ? ' (Local)' : '';
    return `${city} (${timeZone}, UTC${offset})${suffix}`;
  } catch {
    return timeZone;
  }
}

export function getShortTimeZoneAbbr(zdt: TemporalType.ZonedDateTime): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zdt.timeZoneId,
      timeZoneName: 'short',
    }).formatToParts(new Date(zdt.epochMilliseconds));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? zdt.offset;
  } catch {
    return zdt.offset;
  }
}

/**
 * Convert a PlainDate (YYYY-MM-DD) + minutes from midnight in `timeZone`
 * into epoch milliseconds using Temporal.ZonedDateTime.
 */
export function zonedDateMinutesToMs(
  dateStr: string,
  minutesFromMidnight: number,
  timeZone: string
): number {
  const hours = Math.floor(minutesFromMidnight / 60);
  const mins = minutesFromMidnight % 60;
  const plainDate = Temporal.PlainDate.from(dateStr);

  if (hours >= 24) {
    const nextDay = plainDate.add({ days: Math.floor(hours / 24) });
    const remHours = hours % 24;
    const zdt = nextDay.toZonedDateTime({
      timeZone,
      plainTime: Temporal.PlainTime.from({ hour: remHours, minute: mins }),
    });
    return zdt.epochMilliseconds;
  }

  const zdt = plainDate.toZonedDateTime({
    timeZone,
    plainTime: Temporal.PlainTime.from({ hour: hours, minute: mins }),
  });
  return zdt.epochMilliseconds;
}

/**
 * Given an epoch ms and a display timeZone, return the date key (YYYY-MM-DD)
 * and minutes from midnight in that timeZone.
 */
export function msToZonedDateAndMinutes(
  epochMs: number,
  timeZone: string
): { dateStr: string; minutes: number; zdt: TemporalType.ZonedDateTime } {
  const instant = Temporal.Instant.fromEpochMilliseconds(epochMs);
  const zdt = instant.toZonedDateTimeISO(timeZone);
  const dateStr = zdt.toPlainDate().toString();
  const minutes = zdt.hour * 60 + zdt.minute;
  return { dateStr, minutes, zdt };
}

/**
 * Return the 7 PlainDate strings (YYYY-MM-DD) for the week starting on `weekStartPlainDate`.
 */
export function getWeekDates(weekStartDateStr: string): string[] {
  const start = Temporal.PlainDate.from(weekStartDateStr);
  return Array.from({ length: 7 }, (_, i) => start.add({ days: i }).toString());
}

/**
 * Return the Sunday (or Monday) of the week containing today in `timeZone`.
 */
export function getCurrentWeekStart(timeZone: string, startOnMonday = false): string {
  const today = Temporal.Now.plainDateISO(timeZone);
  // dayOfWeek: 1 = Monday ... 7 = Sunday
  const offset = startOnMonday ? today.dayOfWeek - 1 : today.dayOfWeek % 7;
  return today.subtract({ days: offset }).toString();
}

/**
 * Merge overlapping or directly adjacent availability blocks.
 */
export function mergeAvailabilityBlocks(blocks: AvailabilityBlock[]): AvailabilityBlock[] {
  if (blocks.length === 0) return [];
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const merged: AvailabilityBlock[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, curr.endMs);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/**
 * Format availability blocks grouped by day in the target presentation time zone.
 * Handles blocks that cross midnight in the target time zone by splitting at midnight.
 */
export function formatAvailabilityBulletList(
  blocks: AvailabilityBlock[],
  targetTimeZone: string,
  format: BulletFormat = 'standard'
): string {
  const merged = mergeAvailabilityBlocks(blocks);
  if (merged.length === 0) return '';

  interface DaySlice {
    dateStr: string;
    startZdt: TemporalType.ZonedDateTime;
    endZdt: TemporalType.ZonedDateTime;
  }

  const slicesByDay = new Map<string, DaySlice[]>();

  for (const block of merged) {
    let cursorMs = block.startMs;
    const endMs = block.endMs;

    while (cursorMs < endMs) {
      const startZdt = Temporal.Instant.fromEpochMilliseconds(cursorMs).toZonedDateTimeISO(
        targetTimeZone
      );
      const dayStr = startZdt.toPlainDate().toString();
      const nextDayStart = startZdt
        .toPlainDate()
        .add({ days: 1 })
        .toZonedDateTime({ timeZone: targetTimeZone, plainTime: '00:00' });
      const sliceEndMs = Math.min(endMs, nextDayStart.epochMilliseconds);
      const endZdt = Temporal.Instant.fromEpochMilliseconds(sliceEndMs).toZonedDateTimeISO(
        targetTimeZone
      );

      const arr = slicesByDay.get(dayStr) ?? [];
      arr.push({ dateStr: dayStr, startZdt, endZdt });
      slicesByDay.set(dayStr, arr);

      cursorMs = sliceEndMs;
    }
  }

  const sortedDays = Array.from(slicesByDay.keys()).sort();
  if (sortedDays.length === 0) return '';

  const firstSlice = slicesByDay.get(sortedDays[0])![0];
  const tzAbbr = getShortTimeZoneAbbr(firstSlice.startZdt);

  const lines: string[] = [];
  if (format === 'markdown') {
    lines.push(`**Available Times (${targetTimeZone} / ${tzAbbr}):**`);
  } else {
    lines.push(`Available Times (${targetTimeZone} / ${tzAbbr}):`);
  }

  for (const dayStr of sortedDays) {
    const daySlices = slicesByDay.get(dayStr)!;
    const dayLabel = daySlices[0].startZdt.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    if (format === 'compact') {
      const ranges = daySlices.map((s) => `${formatTime(s.startZdt)} – ${formatTime(s.endZdt)}`);
      lines.push(`• ${dayLabel}: ${ranges.join(', ')}`);
    } else if (format === 'markdown') {
      lines.push(`- **${dayLabel}**`);
      for (const s of daySlices) {
        lines.push(`  - ${formatTime(s.startZdt)} – ${formatTime(s.endZdt)} ${tzAbbr}`);
      }
    } else {
      lines.push(`• ${dayLabel}:`);
      for (const s of daySlices) {
        lines.push(`  - ${formatTime(s.startZdt)} – ${formatTime(s.endZdt)} ${tzAbbr}`);
      }
    }
  }

  return lines.join('\n');
}

export function formatTime(zdt: TemporalType.ZonedDateTime): string {
  return zdt.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatMinutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Compute meeting-free intervals within [workStartMin, workEndMin] for a given date.
 */
export function computeFreeIntervalsForDay(
  dateStr: string,
  workStartMin: number,
  workEndMin: number,
  timeZone: string,
  busyEvents: CalendarEvent[],
  minSlotMinutes = 15
): Array<{ startMs: number; endMs: number }> {
  if (workEndMin <= workStartMin) return [];

  const windowStartMs = zonedDateMinutesToMs(dateStr, workStartMin, timeZone);
  const windowEndMs = zonedDateMinutesToMs(dateStr, workEndMin, timeZone);

  const clampedBusy = busyEvents
    .filter((ev) => !ev.allDay && ev.endMs > windowStartMs && ev.startMs < windowEndMs)
    .map((ev) => ({
      startMs: Math.max(windowStartMs, ev.startMs),
      endMs: Math.min(windowEndMs, ev.endMs),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  const mergedBusy: Array<{ startMs: number; endMs: number }> = [];
  for (const b of clampedBusy) {
    if (mergedBusy.length === 0 || b.startMs > mergedBusy[mergedBusy.length - 1].endMs) {
      mergedBusy.push({ ...b });
    } else {
      mergedBusy[mergedBusy.length - 1].endMs = Math.max(
        mergedBusy[mergedBusy.length - 1].endMs,
        b.endMs
      );
    }
  }

  const free: Array<{ startMs: number; endMs: number }> = [];
  const minMs = minSlotMinutes * 60_000;
  let cursor = windowStartMs;

  for (const b of mergedBusy) {
    if (b.startMs - cursor >= minMs) {
      free.push({ startMs: cursor, endMs: b.startMs });
    }
    cursor = Math.max(cursor, b.endMs);
  }

  if (windowEndMs - cursor >= minMs) {
    free.push({ startMs: cursor, endMs: windowEndMs });
  }

  return free;
}
