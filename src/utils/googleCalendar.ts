import type { CalendarEvent, CalendarSource } from '../types';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (error: {
              type: string;
              message?: string;
            }) => void;
          }) => {
            requestAccessToken: (opts?: { prompt?: string }) => void;
          };
          revoke: (token: string, done: () => void) => void;
        };
      };
    };
  }
}

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export class GoogleAuthExpiredError extends Error {
  constructor(message = 'Google session expired. Please refresh to reconnect.') {
    super(message);
    this.name = 'GoogleAuthExpiredError';
  }
}

export interface GoogleTokenResult {
  accessToken: string;
  expiresAt: number;
}

export function isGisLoaded(): boolean {
  return Boolean(window.google?.accounts?.oauth2);
}

export function requestGoogleAccessToken(
  clientId: string,
  prompt: '' | 'consent' | 'select_account' = ''
): Promise<GoogleTokenResult> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(
        new Error(
          'Google Identity Services script is not loaded yet. Check your internet connection and try again.'
        )
      );
      return;
    }

    let settled = false;
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: (resp) => {
        if (settled) return;
        settled = true;
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Google sign-in failed.'));
          return;
        }
        const expiresInSec = typeof resp.expires_in === 'number' ? resp.expires_in : 3600;
        resolve({
          accessToken: resp.access_token,
          expiresAt: Date.now() + expiresInSec * 1000,
        });
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        if (err.type === 'popup_closed') {
          reject(new Error('Sign-in popup was closed before completing.'));
        } else if (err.type === 'popup_failed_to_open') {
          reject(new Error('Sign-in popup was blocked by your browser. Please allow popups for this site.'));
        } else {
          reject(new Error(err.message || `Google sign-in error (${err.type}).`));
        }
      },
    });

    tokenClient.requestAccessToken({ prompt });
  });
}

interface GoogleCalendarListItem {
  id: string;
  summary?: string;
  backgroundColor?: string;
  primary?: boolean;
  selected?: boolean;
}

interface GoogleEventItem {
  id: string;
  summary?: string;
  status?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

export async function fetchGoogleCalendars(accessToken: string): Promise<CalendarSource[]> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (res.status === 401) {
    throw new GoogleAuthExpiredError();
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google CalendarList error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { items?: GoogleCalendarListItem[] };
  const items = data.items ?? [];

  return items.map((item) => ({
    id: `gcal:${item.id}`,
    name: item.summary || item.id,
    color: item.backgroundColor || '#3b82f6',
    enabled: item.selected !== false,
    provider: 'google-oauth',
    primary: Boolean(item.primary),
  }));
}

export async function fetchGoogleEventsForCalendars(
  accessToken: string,
  calendars: CalendarSource[],
  timeMinIso: string,
  timeMaxIso: string
): Promise<CalendarEvent[]> {
  const gcalSources = calendars.filter((c) => c.provider === 'google-oauth');
  let unauthorized = false;

  const results = await Promise.all(
    gcalSources.map(async (cal) => {
      const rawId = cal.id.replace(/^gcal:/, '');
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(rawId)}/events`
      );
      url.searchParams.set('timeMin', timeMinIso);
      url.searchParams.set('timeMax', timeMaxIso);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '500');

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.status === 401) {
        unauthorized = true;
        return [] as CalendarEvent[];
      }

      if (!res.ok) {
        return [] as CalendarEvent[];
      }

      const data = (await res.json()) as { items?: GoogleEventItem[] };
      const events: CalendarEvent[] = [];

      for (const ev of data.items ?? []) {
        if (ev.status === 'cancelled') continue;
        if (ev.start?.dateTime && ev.end?.dateTime) {
          events.push({
            id: `${cal.id}:${ev.id}`,
            calendarId: cal.id,
            title: ev.summary || '(Busy)',
            startMs: new Date(ev.start.dateTime).getTime(),
            endMs: new Date(ev.end.dateTime).getTime(),
            allDay: false,
          });
        } else if (ev.start?.date && ev.end?.date) {
          events.push({
            id: `${cal.id}:${ev.id}`,
            calendarId: cal.id,
            title: ev.summary || '(All day)',
            startMs: new Date(`${ev.start.date}T00:00:00`).getTime(),
            endMs: new Date(`${ev.end.date}T00:00:00`).getTime(),
            allDay: true,
          });
        }
      }

      return events;
    })
  );

  if (unauthorized) {
    throw new GoogleAuthExpiredError();
  }

  return results.flat();
}
