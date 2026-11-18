import ICAL from 'ical.js';
import type { CalendarEvent } from '../types';

/**
 * Parse an ICS string into CalendarEvents within [windowStartMs, windowEndMs],
 * expanding recurring events via ical.js.
 */
export function parseIcsToEvents(
  icsText: string,
  calendarId: string,
  windowStartMs: number,
  windowEndMs: number
): { calendarName?: string; events: CalendarEvent[] } {
  const jcalData = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcalData);
  const calNameProp = comp.getFirstPropertyValue('x-wr-calname');
  const calendarName = typeof calNameProp === 'string' ? calNameProp : undefined;

  const vevents = comp.getAllSubcomponents('vevent');
  const events: CalendarEvent[] = [];

  const rangeEnd = ICAL.Time.fromJSDate(new Date(windowEndMs), true);

  for (const vevent of vevents) {
    try {
      const event = new ICAL.Event(vevent);
      const summary = event.summary || '(Busy)';

      if (event.isRecurring()) {
        const iter = event.iterator();
        let next: ICAL.Time | null;
        let safety = 0;
        while ((next = iter.next()) && safety < 500) {
          safety++;
          if (next.compare(rangeEnd) > 0) break;

          const details = event.getOccurrenceDetails(next);
          const startMs = details.startDate.toJSDate().getTime();
          const endMs = details.endDate.toJSDate().getTime();

          if (endMs >= windowStartMs && startMs <= windowEndMs) {
            events.push({
              id: `${calendarId}:${event.uid}:${startMs}`,
              calendarId,
              title: summary,
              startMs,
              endMs,
              allDay: details.startDate.isDate,
            });
          }
        }
      } else {
        const startMs = event.startDate.toJSDate().getTime();
        const endMs = event.endDate.toJSDate().getTime();

        if (endMs >= windowStartMs && startMs <= windowEndMs) {
          events.push({
            id: `${calendarId}:${event.uid}:${startMs}`,
            calendarId,
            title: summary,
            startMs,
            endMs,
            allDay: event.startDate.isDate,
          });
        }
      }
    } catch {
      // Skip malformed VEVENT entries gracefully
    }
  }

  return { calendarName, events };
}

export async function fetchIcsFromUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  const isLocalDev =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (isLocalDev) {
    const proxyUrl = `/api/ical?url=${encodeURIComponent(trimmed)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) {
      let msg = `Failed to fetch iCal feed (${res.status})`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) msg = data.error;
      } catch {
        // ignore json parse failure
      }
      throw new Error(msg);
    }
    return res.text();
  }

  try {
    const res = await fetch(trimmed);
    if (!res.ok) {
      throw new Error(`Failed to fetch iCal feed (${res.status})`);
    }
    return res.text();
  } catch {
    throw new Error(
      'Could not fetch this iCal URL directly from the browser (CORS blocked). Use Google Sign-In (OAuth) or upload a downloaded .ics file instead.'
    );
  }
}
