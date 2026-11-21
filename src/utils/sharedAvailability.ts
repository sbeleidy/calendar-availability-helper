import type { AvailabilityBlock, HeatmapSegment } from '../types';
import { mergeAvailabilityBlocks } from './temporal';

export interface OverlapParticipant {
  id: string;
  enabled: boolean;
  blocks: AvailabilityBlock[];
}

/**
 * Compute contiguous overlap segments across all enabled participants using
 * an exact sweep-line algorithm over merged block boundaries.
 */
export function computeHeatmapSegments(
  participants: OverlapParticipant[],
  rangeStartMs?: number,
  rangeEndMs?: number
): HeatmapSegment[] {
  const active = participants.filter((p) => p.enabled);
  const total = active.length;
  if (total === 0) return [];

  const hasRange = rangeStartMs !== undefined && rangeEndMs !== undefined;
  if (hasRange && rangeEndMs <= rangeStartMs) return [];

  // Normalize each participant's blocks (merged and clamped to range if provided)
  const normalizedByParticipant = active.map((p) => {
    const merged = mergeAvailabilityBlocks(p.blocks);
    const clamped = hasRange
      ? merged
          .filter((b) => b.endMs > rangeStartMs && b.startMs < rangeEndMs)
          .map((b) => ({
            startMs: Math.max(rangeStartMs, b.startMs),
            endMs: Math.min(rangeEndMs, b.endMs),
          }))
      : merged.map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
    return { id: p.id, intervals: clamped };
  });

  // Collect all unique boundary timestamps
  const boundarySet = new Set<number>();
  for (const p of normalizedByParticipant) {
    for (const iv of p.intervals) {
      boundarySet.add(iv.startMs);
      boundarySet.add(iv.endMs);
    }
  }

  const boundaries = Array.from(boundarySet).sort((a, b) => a - b);
  if (boundaries.length < 2) return [];

  const segments: HeatmapSegment[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    if (segEnd <= segStart) continue;

    const availableIds: string[] = [];
    const unavailableIds: string[] = [];

    for (const p of normalizedByParticipant) {
      const isCovered = p.intervals.some(
        (iv) => iv.startMs <= segStart && iv.endMs >= segEnd
      );
      if (isCovered) {
        availableIds.push(p.id);
      } else {
        unavailableIds.push(p.id);
      }
    }

    if (availableIds.length === 0) continue;

    const prev = segments[segments.length - 1];
    const sameParticipants =
      prev &&
      prev.endMs === segStart &&
      prev.availableIds.length === availableIds.length &&
      prev.availableIds.every((id, idx) => id === availableIds[idx]);

    if (sameParticipants) {
      prev.endMs = segEnd;
    } else {
      segments.push({
        startMs: segStart,
        endMs: segEnd,
        availableIds,
        unavailableIds,
        count: availableIds.length,
        total,
      });
    }
  }

  return segments;
}

/**
 * Return merged AvailabilityBlocks where at least `minCount` enabled
 * participants are simultaneously available.
 */
export function computeSharedAvailabilityBlocks(
  participants: OverlapParticipant[],
  minCount: number
): AvailabilityBlock[] {
  const active = participants.filter((p) => p.enabled);
  if (active.length === 0 || minCount <= 0) return [];

  const segments = computeHeatmapSegments(active);
  const qualifying: AvailabilityBlock[] = segments
    .filter((seg) => seg.count >= minCount)
    .map((seg) => ({
      id: `shared:${seg.startMs}-${seg.endMs}`,
      startMs: seg.startMs,
      endMs: seg.endMs,
    }));

  return mergeAvailabilityBlocks(qualifying);
}
