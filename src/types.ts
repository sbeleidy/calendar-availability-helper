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
