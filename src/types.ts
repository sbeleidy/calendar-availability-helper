export type CalendarProvider = 'google-oauth' | 'ical-url' | 'ical-file' | 'demo';

export interface CalendarSource {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  provider: CalendarProvider;
  icalUrl?: string;
  primary?: boolean;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** Epoch milliseconds */
  startMs: number;
  /** Epoch milliseconds */
  endMs: number;
  allDay?: boolean;
  location?: string;
}

/**
 * A user-highlighted availability interval stored as exact epoch milliseconds
 * so it can be cleanly rendered in the calendar's display time zone and
 * converted to any target presentation time zone via Temporal.ZonedDateTime.
 */
export interface AvailabilityBlock {
  id: string;
  startMs: number;
  endMs: number;
}

export type BulletFormat = 'standard' | 'compact' | 'markdown';

export type CalendarViewMode = 'edit' | 'heatmap';

export interface ParticipantAvailability {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  /** Original pasted text preserved so the user can edit and re-parse later */
  rawText: string;
  /** Fallback IANA time zone used when pasted text omits a time zone */
  defaultTimeZone: string;
  /** Reference week start (YYYY-MM-DD) used for weekday-only lines like "Tue 2-4 PM" */
  referenceWeekStart: string;
  /** Parsed & merged epoch-ms intervals */
  blocks: AvailabilityBlock[];
  updatedAt: number;
}

export interface HeatmapSegment {
  startMs: number;
  endMs: number;
  availableIds: string[];
  unavailableIds: string[];
  count: number;
  total: number;
}

