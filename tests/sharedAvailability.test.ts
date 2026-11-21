import { beforeAll, describe, expect, it } from 'vitest';
import { ensureTemporal, zonedDateMinutesToMs } from '../src/utils/temporal';
import {
  computeHeatmapSegments,
  computeSharedAvailabilityBlocks,
} from '../src/utils/sharedAvailability';

beforeAll(async () => {
  await ensureTemporal();
});

const t = (dateStr: string, hour: number, minute = 0) =>
  zonedDateMinutesToMs(dateStr, hour * 60 + minute, 'UTC');

describe('computeHeatmapSegments', () => {
  it('returns empty array when no enabled participants exist', () => {
    expect(computeHeatmapSegments([])).toEqual([]);
    expect(
      computeHeatmapSegments([
        {
          id: 'a',
          enabled: false,
          blocks: [{ id: '1', startMs: t('2026-11-24', 9), endMs: t('2026-11-24', 11) }],
        },
      ])
    ).toEqual([]);
  });

  it('splits partial overlaps into exact contiguous segments with available/unavailable ids', () => {
    const participants = [
      {
        id: 'me',
        enabled: true,
        blocks: [{ id: 'm1', startMs: t('2026-11-24', 9), endMs: t('2026-11-24', 12) }],
      },
      {
        id: 'alex',
        enabled: true,
        blocks: [{ id: 'a1', startMs: t('2026-11-24', 10), endMs: t('2026-11-24', 13) }],
      },
      {
        id: 'sam',
        enabled: true,
        blocks: [{ id: 's1', startMs: t('2026-11-24', 11), endMs: t('2026-11-24', 12) }],
      },
    ];

    const segments = computeHeatmapSegments(participants);

    expect(segments).toEqual([
      {
        startMs: t('2026-11-24', 9),
        endMs: t('2026-11-24', 10),
        availableIds: ['me'],
        unavailableIds: ['alex', 'sam'],
        count: 1,
        total: 3,
      },
      {
        startMs: t('2026-11-24', 10),
        endMs: t('2026-11-24', 11),
        availableIds: ['me', 'alex'],
        unavailableIds: ['sam'],
        count: 2,
        total: 3,
      },
      {
        startMs: t('2026-11-24', 11),
        endMs: t('2026-11-24', 12),
        availableIds: ['me', 'alex', 'sam'],
        unavailableIds: [],
        count: 3,
        total: 3,
      },
      {
        startMs: t('2026-11-24', 12),
        endMs: t('2026-11-24', 13),
        availableIds: ['alex'],
        unavailableIds: ['me', 'sam'],
        count: 1,
        total: 3,
      },
    ]);
  });

  it('ignores disabled participants in both count and total', () => {
    const participants = [
      {
        id: 'me',
        enabled: true,
        blocks: [{ id: 'm1', startMs: t('2026-11-24', 9), endMs: t('2026-11-24', 11) }],
      },
      {
        id: 'alex',
        enabled: false,
        blocks: [{ id: 'a1', startMs: t('2026-11-24', 10), endMs: t('2026-11-24', 12) }],
      },
    ];

    const segments = computeHeatmapSegments(participants);
    expect(segments).toEqual([
      {
        startMs: t('2026-11-24', 9),
        endMs: t('2026-11-24', 11),
        availableIds: ['me'],
        unavailableIds: [],
        count: 1,
        total: 1,
      },
    ]);
  });

  it('clamps segments to optional rangeStartMs and rangeEndMs', () => {
    const participants = [
      {
        id: 'me',
        enabled: true,
        blocks: [{ id: 'm1', startMs: t('2026-11-24', 8), endMs: t('2026-11-24', 14) }],
      },
    ];

    const segments = computeHeatmapSegments(
      participants,
      t('2026-11-24', 9),
      t('2026-11-24', 12)
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].startMs).toBe(t('2026-11-24', 9));
    expect(segments[0].endMs).toBe(t('2026-11-24', 12));
  });
});

describe('computeSharedAvailabilityBlocks', () => {
  const buildParticipants = () => [
    {
      id: 'me',
      enabled: true,
      blocks: [{ id: 'm1', startMs: t('2026-11-24', 9), endMs: t('2026-11-24', 12) }],
    },
    {
      id: 'alex',
      enabled: true,
      blocks: [{ id: 'a1', startMs: t('2026-11-24', 10), endMs: t('2026-11-24', 13) }],
    },
    {
      id: 'sam',
      enabled: true,
      blocks: [{ id: 's1', startMs: t('2026-11-24', 11), endMs: t('2026-11-24', 12) }],
    },
  ];

  it('returns only full-overlap blocks when minCount equals total', () => {
    const blocks = computeSharedAvailabilityBlocks(buildParticipants(), 3);
    expect(blocks.map((b) => [b.startMs, b.endMs])).toEqual([
      [t('2026-11-24', 11), t('2026-11-24', 12)],
    ]);
  });

  it('merges adjacent qualifying segments when minCount is lower than total', () => {
    const blocks = computeSharedAvailabilityBlocks(buildParticipants(), 2);
    expect(blocks.map((b) => [b.startMs, b.endMs])).toEqual([
      [t('2026-11-24', 10), t('2026-11-24', 12)],
    ]);
  });
});
