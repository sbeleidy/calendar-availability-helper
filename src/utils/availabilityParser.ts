import type { AvailabilityBlock } from '../types';
import {
  getWeekDates,
  mergeAvailabilityBlocks,
  zonedDateMinutesToMs,
} from './temporal';

export interface ParseAvailabilityOptions {
  /** Fallback IANA time zone when pasted text does not specify one */
  defaultTimeZone: string;
  /** YYYY-MM-DD start of the reference week for weekday-only inputs (e.g. "Tue 2-4 PM") */
  referenceWeekStart: string;
}

export interface ParsedLineResult {
  lineNumber: number;
  rawLine: string;
  status: 'parsed' | 'header' | 'ignored' | 'unparsed';
  blocks: AvailabilityBlock[];
  reason?: string;
}

export interface ParseAvailabilityResult {
  blocks: AvailabilityBlock[];
  detectedTimeZone: string | null;
  lines: ParsedLineResult[];
  warnings: string[];
}

const TZ_ABBR_TO_IANA: Record<string, string> = {
  EST: 'America/New_York',
  EDT: 'America/New_York',
  ET: 'America/New_York',
  CST: 'America/Chicago',
  CDT: 'America/Chicago',
  CT: 'America/Chicago',
  MST: 'America/Denver',
  MDT: 'America/Denver',
  MT: 'America/Denver',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  PT: 'America/Los_Angeles',
  UTC: 'UTC',
  GMT: 'UTC',
  BST: 'Europe/London',
  WET: 'Europe/London',
  CET: 'Europe/Paris',
  CEST: 'Europe/Paris',
  IST: 'Asia/Kolkata',
  JST: 'Asia/Tokyo',
  KST: 'Asia/Seoul',
  SGT: 'Asia/Singapore',
  AEST: 'Australia/Sydney',
  AEDT: 'Australia/Sydney',
  NZST: 'Pacific/Auckland',
  NZDT: 'Pacific/Auckland',
};

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** ISO dayOfWeek: 1 = Monday .. 7 = Sunday */
const WEEKDAY_MAP: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};

const MONTH_PATTERN =
  'january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec';

const WEEKDAY_PATTERN =
  'monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun';

const TZ_ABBR_PATTERN = Object.keys(TZ_ABBR_TO_IANA)
  .sort((a, b) => b.length - a.length)
  .join('|');

function isValidIanaTimeZone(tz: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(tz);
    return true;
  } catch {
    return false;
  }
}

function detectTimeZoneInText(text: string): string | null {
  // 1. Check explicit IANA time zone identifiers like America/New_York or Europe/London
  const ianaMatches = text.match(/\b([A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)\b/g);
  if (ianaMatches) {
    for (const candidate of ianaMatches) {
      if (isValidIanaTimeZone(candidate)) {
        return candidate;
      }
    }
  }

  // 2. Check known abbreviations (case-insensitive, word-bounded)
  const abbrRegex = new RegExp(`\\b(${TZ_ABBR_PATTERN})\\b`, 'i');
  const abbrMatch = text.match(abbrRegex);
  if (abbrMatch) {
    const key = abbrMatch[1].toUpperCase();
    if (key in TZ_ABBR_TO_IANA) {
      return TZ_ABBR_TO_IANA[key];
    }
  }

  return null;
}

function resolveYearForMonthDay(month: number, day: number, referenceWeekStart: string): number {
  const ref = Temporal.PlainDate.from(referenceWeekStart);
  const candidates = [ref.year - 1, ref.year, ref.year + 1];
  let bestYear = ref.year;
  let bestDiff = Infinity;

  for (const year of candidates) {
    try {
      const candidate = Temporal.PlainDate.from({ year, month, day });
      const diff = Math.abs(ref.until(candidate, { largestUnit: 'days' }).days);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestYear = year;
      }
    } catch {
      // Invalid date (e.g. Feb 29 on non-leap year)
    }
  }
  return bestYear;
}

function extractDateFromLine(
  line: string,
  weekDates: string[],
  referenceWeekStart: string
): { dateStr: string; remainder: string } | null {
  // Strip leading bullets, dashes, markdown bold/italics
  const cleaned = line.replace(/^[\s•*\-–—]+/, '').replace(/\*\*/g, '').trim();
  if (!cleaned) return null;

  // 1. ISO date: YYYY-MM-DD
  const isoMatch = cleaned.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    try {
      const pd = Temporal.PlainDate.from({ year, month, day });
      const remainder = cleaned.replace(isoMatch[0], ' ').replace(/^[\s,:;\-–—]+/, '');
      return { dateStr: pd.toString(), remainder };
    } catch {
      // fall through
    }
  }

  // 2. Optional weekday + Month Day[, Year] (e.g. "Tue, Nov 24", "November 24th, 2026")
  const monthDayRegex = new RegExp(
    `(?:\\b(?:${WEEKDAY_PATTERN})\\.?\\s*,?\\s+)?\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    'i'
  );
  const monthDayMatch = cleaned.match(monthDayRegex);
  if (monthDayMatch) {
    const month = MONTH_MAP[monthDayMatch[1].toLowerCase()];
    const day = Number(monthDayMatch[2]);
    const year = monthDayMatch[3]
      ? Number(monthDayMatch[3])
      : resolveYearForMonthDay(month, day, referenceWeekStart);
    try {
      const pd = Temporal.PlainDate.from({ year, month, day });
      const remainder = cleaned.replace(monthDayMatch[0], ' ').replace(/^[\s,:;\-–—]+/, '');
      return { dateStr: pd.toString(), remainder };
    } catch {
      // fall through
    }
  }

  // 3. Numeric MM/DD[/YYYY]
  const slashMatch = cleaned.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    let year: number;
    if (slashMatch[3]) {
      const rawYear = Number(slashMatch[3]);
      year = rawYear < 100 ? 2000 + rawYear : rawYear;
    } else {
      year = resolveYearForMonthDay(month, day, referenceWeekStart);
    }
    try {
      const pd = Temporal.PlainDate.from({ year, month, day });
      const remainder = cleaned.replace(slashMatch[0], ' ').replace(/^[\s,:;\-–—]+/, '');
      return { dateStr: pd.toString(), remainder };
    } catch {
      // fall through
    }
  }

  // 4. Weekday-only (e.g. "Tue 2-4 PM", "Thursday:")
  const weekdayRegex = new RegExp(`\\b(${WEEKDAY_PATTERN})\\.?\\b`, 'i');
  const weekdayMatch = cleaned.match(weekdayRegex);
  if (weekdayMatch) {
    const targetDow = WEEKDAY_MAP[weekdayMatch[1].toLowerCase()];
    const matchedDay = weekDates.find(
      (d) => Temporal.PlainDate.from(d).dayOfWeek === targetDow
    );
    if (matchedDay) {
      const remainder = cleaned.replace(weekdayMatch[0], ' ').replace(/^[\s,:;\-–—]+/, '');
      return { dateStr: matchedDay, remainder };
    }
  }

  return null;
}

function to24Hour(hour: number, meridiem: 'am' | 'pm'): number {
  if (meridiem === 'am') {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

function resolveTimeRangeMinutes(
  startHourRaw: number,
  startMin: number,
  startMeridiem: 'am' | 'pm' | null,
  endHourRaw: number,
  endMin: number,
  endMeridiem: 'am' | 'pm' | null
): { startMinTotal: number; endMinTotal: number } | null {
  if (startMin < 0 || startMin > 59 || endMin < 0 || endMin > 59) return null;
  if (startHourRaw > 24 || endHourRaw > 24) return null;
  if ((startMeridiem && (startHourRaw < 1 || startHourRaw > 12)) || (endMeridiem && (endHourRaw < 1 || endHourRaw > 12))) {
    return null;
  }

  let startHour: number;
  let endHour: number;

  if (startMeridiem && endMeridiem) {
    startHour = to24Hour(startHourRaw, startMeridiem);
    endHour = to24Hour(endHourRaw, endMeridiem);
  } else if (!startMeridiem && endMeridiem) {
    endHour = to24Hour(endHourRaw, endMeridiem);
    // First try inheriting end's meridiem (e.g. "2-4 PM" -> 2 PM - 4 PM)
    const sameMeridiemStart = startHourRaw <= 12 ? to24Hour(startHourRaw, endMeridiem) : startHourRaw;
    if (sameMeridiemStart * 60 + startMin < endHour * 60 + endMin) {
      startHour = sameMeridiemStart;
    } else if (startHourRaw <= 12) {
      // Otherwise flip meridiem (e.g. "10-2 PM" -> 10 AM - 2 PM)
      const opp: 'am' | 'pm' = endMeridiem === 'pm' ? 'am' : 'pm';
      startHour = to24Hour(startHourRaw, opp);
    } else {
      startHour = startHourRaw;
    }
  } else if (startMeridiem && !endMeridiem) {
    startHour = to24Hour(startHourRaw, startMeridiem);
    const sameMeridiemEnd = endHourRaw <= 12 ? to24Hour(endHourRaw, startMeridiem) : endHourRaw;
    if (sameMeridiemEnd * 60 + endMin > startHour * 60 + startMin) {
      endHour = sameMeridiemEnd;
    } else if (endHourRaw <= 12) {
      const opp: 'am' | 'pm' = startMeridiem === 'pm' ? 'am' : 'pm';
      endHour = to24Hour(endHourRaw, opp);
    } else {
      endHour = endHourRaw;
    }
  } else {
    // 24-hour or ambiguous bare numbers
    startHour = startHourRaw;
    endHour = endHourRaw;
    if (endHour * 60 + endMin <= startHour * 60 + startMin && endHour < 12) {
      endHour += 12;
    }
  }

  const startMinTotal = startHour * 60 + startMin;
  let endMinTotal = endHour * 60 + endMin;

  // Handle midnight end time like "10:00 PM - 12:00 AM"
  if (endMinTotal === 0 && startMinTotal > 0) {
    endMinTotal = 24 * 60;
  }

  if (endMinTotal <= startMinTotal || endMinTotal > 24 * 60) {
    return null;
  }

  return { startMinTotal, endMinTotal };
}

const TIME_RANGE_REGEX = new RegExp(
  `(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*(?:-|–|—|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?(?:\\s*(${TZ_ABBR_PATTERN}))?`,
  'gi'
);

interface ExtractedTimeRange {
  startMinTotal: number;
  endMinTotal: number;
  timeZone: string | null;
}

function extractTimeRanges(text: string): ExtractedTimeRange[] {
  const results: ExtractedTimeRange[] = [];
  TIME_RANGE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TIME_RANGE_REGEX.exec(text)) !== null) {
    const startHourRaw = Number(match[1]);
    const startMin = match[2] ? Number(match[2]) : 0;
    const startMeridiem = match[3] ? (match[3].toLowerCase() as 'am' | 'pm') : null;
    const endHourRaw = Number(match[4]);
    const endMin = match[5] ? Number(match[5]) : 0;
    const endMeridiem = match[6] ? (match[6].toLowerCase() as 'am' | 'pm') : null;
    const tzAbbr = match[7] ? match[7].toUpperCase() : null;

    const resolved = resolveTimeRangeMinutes(
      startHourRaw,
      startMin,
      startMeridiem,
      endHourRaw,
      endMin,
      endMeridiem
    );
    if (!resolved) continue;

    results.push({
      startMinTotal: resolved.startMinTotal,
      endMinTotal: resolved.endMinTotal,
      timeZone: tzAbbr && tzAbbr in TZ_ABBR_TO_IANA ? TZ_ABBR_TO_IANA[tzAbbr] : null,
    });
  }

  return results;
}

export function parseAvailabilityText(
  text: string,
  options: ParseAvailabilityOptions
): ParseAvailabilityResult {
  const weekDates = getWeekDates(options.referenceWeekStart);
  const rawLines = text.split(/\r?\n/);

  let detectedTimeZone: string | null = null;
  let activeTimeZone = options.defaultTimeZone;
  let currentDateStr: string | null = null;

  const lineResults: ParsedLineResult[] = [];
  const allBlocks: AvailabilityBlock[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();
    const lineNumber = i + 1;

    if (!trimmed) {
      lineResults.push({ lineNumber, rawLine, status: 'ignored', blocks: [] });
      continue;
    }

    const lineTz = detectTimeZoneInText(trimmed);
    const extractedDate = extractDateFromLine(trimmed, weekDates, options.referenceWeekStart);
    const textForTimes = extractedDate ? extractedDate.remainder : trimmed;
    const ranges = extractTimeRanges(textForTimes);

    // Header line (e.g. "Available Times (America/New_York / EST):" or "Times in PST:")
    if (!extractedDate && ranges.length === 0 && lineTz) {
      if (!detectedTimeZone) detectedTimeZone = lineTz;
      activeTimeZone = lineTz;
      lineResults.push({ lineNumber, rawLine, status: 'header', blocks: [] });
      continue;
    }

    // Date-only heading line (e.g. "• Tue, Nov 24:" or "- **Tue, Nov 24**")
    if (extractedDate && ranges.length === 0) {
      currentDateStr = extractedDate.dateStr;
      if (lineTz && !detectedTimeZone) {
        detectedTimeZone = lineTz;
        activeTimeZone = lineTz;
      }
      lineResults.push({ lineNumber, rawLine, status: 'header', blocks: [] });
      continue;
    }

    // Line with time ranges
    if (ranges.length > 0) {
      const targetDate = extractedDate ? extractedDate.dateStr : currentDateStr;
      if (extractedDate) {
        currentDateStr = extractedDate.dateStr;
      }

      if (!targetDate) {
        const reason = `Line ${lineNumber}: Found time range(s) without a date ("${trimmed}")`;
        warnings.push(reason);
        lineResults.push({ lineNumber, rawLine, status: 'unparsed', blocks: [], reason });
        continue;
      }

      const lineBlocks: AvailabilityBlock[] = [];
      for (const r of ranges) {
        const tz = r.timeZone ?? lineTz ?? activeTimeZone;
        if (r.timeZone && !detectedTimeZone) detectedTimeZone = r.timeZone;
        const startMs = zonedDateMinutesToMs(targetDate, r.startMinTotal, tz);
        const endMs = zonedDateMinutesToMs(targetDate, r.endMinTotal, tz);
        if (endMs > startMs) {
          lineBlocks.push({
            id: `parsed:${targetDate}:${startMs}-${endMs}`,
            startMs,
            endMs,
          });
        }
      }

      allBlocks.push(...lineBlocks);
      lineResults.push({ lineNumber, rawLine, status: 'parsed', blocks: lineBlocks });
      continue;
    }

    // Unparsed non-empty line
    const reason = `Line ${lineNumber}: Could not parse "${trimmed}"`;
    warnings.push(reason);
    lineResults.push({ lineNumber, rawLine, status: 'unparsed', blocks: [], reason });
  }

  return {
    blocks: mergeAvailabilityBlocks(allBlocks),
    detectedTimeZone,
    lines: lineResults,
    warnings,
  };
}
