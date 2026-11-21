import { beforeAll, describe, expect, it } from 'vitest';
import {
  ensureTemporal,
  formatAvailabilityBulletList,
  zonedDateMinutesToMs,
} from '../src/utils/temporal';
import { parseAvailabilityText } from '../src/utils/availabilityParser';
import type { AvailabilityBlock } from '../src/types';

beforeAll(async () => {
  await ensureTemporal();
});

describe('parseAvailabilityText', () => {
  const defaultOpts = {
    defaultTimeZone: 'America/Los_Angeles',
    referenceWeekStart: '2026-11-22', // Sun Nov 22 .. Sat Nov 28, 2026
  };

  it('round-trips SlotPicker standard format', () => {
    const original: AvailabilityBlock[] = [
      {
        id: '1',
        startMs: zonedDateMinutesToMs('2026-11-24', 10 * 60, 'America/New_York'),
        endMs: zonedDateMinutesToMs('2026-11-24', 12 * 60, 'America/New_York'),
      },
      {
        id: '2',
        startMs: zonedDateMinutesToMs('2026-11-24', 14 * 60, 'America/New_York'),
        endMs: zonedDateMinutesToMs('2026-11-24', 16 * 60 + 30, 'America/New_York'),
      },
      {
        id: '3',
        startMs: zonedDateMinutesToMs('2026-11-26', 9 * 60 + 30, 'America/New_York'),
        endMs: zonedDateMinutesToMs('2026-11-26', 11 * 60, 'America/New_York'),
      },
    ];

    const formatted = formatAvailabilityBulletList(original, 'America/New_York', 'standard');
    const parsed = parseAvailabilityText(formatted, defaultOpts);

    expect(parsed.detectedTimeZone).toBe('America/New_York');
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.blocks.map((b) => [b.startMs, b.endMs])).toEqual(
      original.map((b) => [b.startMs, b.endMs])
    );
  });

  it('round-trips SlotPicker compact and markdown formats', () => {
    const original: AvailabilityBlock[] = [
      {
        id: '1',
        startMs: zonedDateMinutesToMs('2026-11-23', 13 * 60, 'Europe/London'),
        endMs: zonedDateMinutesToMs('2026-11-23', 15 * 60, 'Europe/London'),
      },
      {
        id: '2',
        startMs: zonedDateMinutesToMs('2026-11-23', 16 * 60, 'Europe/London'),
        endMs: zonedDateMinutesToMs('2026-11-23', 17 * 60 + 30, 'Europe/London'),
      },
    ];

    for (const fmt of ['compact', 'markdown'] as const) {
      const formatted = formatAvailabilityBulletList(original, 'Europe/London', fmt);
      const parsed = parseAvailabilityText(formatted, defaultOpts);

      expect(parsed.detectedTimeZone).toBe('Europe/London');
      expect(parsed.warnings).toHaveLength(0);
      expect(parsed.blocks.map((b) => [b.startMs, b.endMs])).toEqual(
        original.map((b) => [b.startMs, b.endMs])
      );
    }
  });

  it('parses casual email lines with weekday-only dates and inline time zone abbreviations', () => {
    const text = `
      Tue 2-4 PM EST
      Thu 10am - 12:30pm EST, 3-5pm EST
    `;
    const parsed = parseAvailabilityText(text, defaultOpts);

    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.blocks.map((b) => [b.startMs, b.endMs])).toEqual([
      [
        zonedDateMinutesToMs('2026-11-24', 14 * 60, 'America/New_York'),
        zonedDateMinutesToMs('2026-11-24', 16 * 60, 'America/New_York'),
      ],
      [
        zonedDateMinutesToMs('2026-11-26', 10 * 60, 'America/New_York'),
        zonedDateMinutesToMs('2026-11-26', 12 * 60 + 30, 'America/New_York'),
      ],
      [
        zonedDateMinutesToMs('2026-11-26', 15 * 60, 'America/New_York'),
        zonedDateMinutesToMs('2026-11-26', 17 * 60, 'America/New_York'),
      ],
    ]);
  });

  it('handles implicit AM/PM inference when only end meridiem is given (e.g. 10-2 PM)', () => {
    const parsed = parseAvailabilityText('Wed 10-2 PM', defaultOpts);

    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].startMs).toBe(
      zonedDateMinutesToMs('2026-11-25', 10 * 60, 'America/Los_Angeles')
    );
    expect(parsed.blocks[0].endMs).toBe(
      zonedDateMinutesToMs('2026-11-25', 14 * 60, 'America/Los_Angeles')
    );
  });

  it('parses numeric dates (MM/DD, YYYY-MM-DD) and 24-hour times', () => {
    const text = `
      11/24 14:00-16:30
      2026-11-25 09:00 to 11:30
    `;
    const parsed = parseAvailabilityText(text, defaultOpts);

    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.blocks.map((b) => [b.startMs, b.endMs])).toEqual([
      [
        zonedDateMinutesToMs('2026-11-24', 14 * 60, 'America/Los_Angeles'),
        zonedDateMinutesToMs('2026-11-24', 16 * 60 + 30, 'America/Los_Angeles'),
      ],
      [
        zonedDateMinutesToMs('2026-11-25', 9 * 60, 'America/Los_Angeles'),
        zonedDateMinutesToMs('2026-11-25', 11 * 60 + 30, 'America/Los_Angeles'),
      ],
    ]);
  });

  it('surfaces warnings for unparseable lines without throwing and still parses valid lines', () => {
    const text = `
      Hey! Here is when I'm free:
      Mon 9-11am PST
      Let me know what works!
    `;
    const parsed = parseAvailabilityText(text, defaultOpts);

    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].startMs).toBe(
      zonedDateMinutesToMs('2026-11-23', 9 * 60, 'America/Los_Angeles')
    );
    expect(parsed.blocks[0].endMs).toBe(
      zonedDateMinutesToMs('2026-11-23', 11 * 60, 'America/Los_Angeles')
    );
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(1);
  });
});
