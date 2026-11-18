import type { CalendarEvent, CalendarSource } from '../types';
import { getWeekDates, zonedDateMinutesToMs } from './temporal';

export const DEMO_CALENDARS: CalendarSource[] = [
  {
    id: 'demo:work',
    name: 'Work (Primary)',
    color: '#2563eb',
    enabled: true,
    provider: 'demo',
    primary: true,
  },
  {
    id: 'demo:team',
    name: 'Team & Eng Syncs',
    color: '#7c3aed',
    enabled: true,
    provider: 'demo',
  },
  {
    id: 'demo:personal',
    name: 'Personal',
    color: '#db2777',
    enabled: true,
    provider: 'demo',
  },
];

export function buildDemoEventsForWeek(
  weekStartDateStr: string,
  timeZone: string
): CalendarEvent[] {
  const days = getWeekDates(weekStartDateStr);

  const specs: Array<{
    dayIdx: number;
    startMin: number;
    endMin: number;
    calendarId: string;
    title: string;
  }> = [
    { dayIdx: 1, startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, calendarId: 'demo:work', title: 'Weekly Planning' },
    { dayIdx: 1, startMin: 13 * 60, endMin: 14 * 60, calendarId: 'demo:team', title: 'Frontend Architecture' },
    { dayIdx: 1, startMin: 17 * 60 + 30, endMin: 18 * 60 + 30, calendarId: 'demo:personal', title: 'Gym' },

    { dayIdx: 2, startMin: 9 * 60, endMin: 9 * 60 + 30, calendarId: 'demo:team', title: 'Standup' },
    { dayIdx: 2, startMin: 11 * 60, endMin: 12 * 60 + 30, calendarId: 'demo:work', title: 'Product Review' },
    { dayIdx: 2, startMin: 14 * 60, endMin: 15 * 60, calendarId: 'demo:work', title: '1:1 w/ Sarah' },
    { dayIdx: 2, startMin: 14 * 60 + 30, endMin: 15 * 60 + 30, calendarId: 'demo:team', title: 'Design Crit' },

    { dayIdx: 3, startMin: 10 * 60, endMin: 11 * 60 + 30, calendarId: 'demo:work', title: 'Focus Block' },
    { dayIdx: 3, startMin: 15 * 60, endMin: 16 * 60, calendarId: 'demo:personal', title: 'Dentist Appt' },

    { dayIdx: 4, startMin: 9 * 60, endMin: 9 * 60 + 30, calendarId: 'demo:team', title: 'Standup' },
    { dayIdx: 4, startMin: 12 * 60, endMin: 13 * 60, calendarId: 'demo:personal', title: 'Lunch w/ Alex' },
    { dayIdx: 4, startMin: 14 * 60, endMin: 16 * 60, calendarId: 'demo:work', title: 'Sprint Demo & Retro' },

    { dayIdx: 5, startMin: 10 * 60 + 30, endMin: 11 * 60 + 30, calendarId: 'demo:work', title: 'Roadmap Sync' },
    { dayIdx: 5, startMin: 13 * 60 + 30, endMin: 14 * 60 + 30, calendarId: 'demo:team', title: 'Office Hours' },
  ];

  return specs.map((s, idx) => {
    const dateStr = days[s.dayIdx];
    return {
      id: `demo-ev-${dateStr}-${idx}`,
      calendarId: s.calendarId,
      title: s.title,
      startMs: zonedDateMinutesToMs(dateStr, s.startMin, timeZone),
      endMs: zonedDateMinutesToMs(dateStr, s.endMin, timeZone),
    };
  });
}
