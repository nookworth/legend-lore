import { describe, it, expect } from 'vitest';
import { orderMoments } from '../pipeline/order-moments.js';
import type { MomentCandidate } from '../shared/types.js';

function makeMoment(rank: number, start_time: number): MomentCandidate {
  return { rank, start_time, end_time: start_time + 10000, summary: `Moment ${rank}`, transcript_excerpt: '', preceding_events: '', category: 'roleplay', reasoning: '', visual_description: '' };
}

describe('orderMoments', () => {
  it('sorts by rank then reorders top 3 chronologically', () => {
    const moments = [
      makeMoment(2, 50000),
      makeMoment(1, 30000),
      makeMoment(3, 10000),
    ];
    const result = orderMoments(moments);
    expect(result).toHaveLength(3);
    // top 3 reordered by start_time: rank 3 (10000), rank 1 (30000), rank 2 (50000)
    expect(result[0]!.rank).toBe(3);
    expect(result[1]!.rank).toBe(1);
    expect(result[2]!.rank).toBe(2);
    expect(result[0]!.start_time).toBe(10000);
    expect(result[1]!.start_time).toBe(30000);
    expect(result[2]!.start_time).toBe(50000);
  });

  it('moves additional moments after the top 3 in rank order', () => {
    const moments = [
      makeMoment(3, 30000),
      makeMoment(1, 10000),
      makeMoment(4, 99999),
      makeMoment(2, 20000),
      makeMoment(5, 88888),
    ];
    const result = orderMoments(moments);
    expect(result).toHaveLength(5);
    // top 3 chronological: rank 1 (10000), rank 2 (20000), rank 3 (30000)
    expect(result[0]!.rank).toBe(1);
    expect(result[1]!.rank).toBe(2);
    expect(result[2]!.rank).toBe(3);
    // remaining in rank order: 4, 5
    expect(result[3]!.rank).toBe(4);
    expect(result[4]!.rank).toBe(5);
  });

  it('handles fewer than 3 moments', () => {
    const moments = [makeMoment(2, 50000), makeMoment(1, 10000)];
    const result = orderMoments(moments);
    expect(result).toHaveLength(2);
    expect(result[0]!.rank).toBe(1);
    expect(result[1]!.rank).toBe(2);
    // reordered chronologically
    expect(result[0]!.start_time).toBe(10000);
    expect(result[1]!.start_time).toBe(50000);
  });

  it('handles empty array', () => {
    expect(orderMoments([])).toEqual([]);
  });

  it('handles single moment', () => {
    const result = orderMoments([makeMoment(1, 10000)]);
    expect(result).toHaveLength(1);
    expect(result[0]!.rank).toBe(1);
  });

  it('does not mutate the input array', () => {
    const input = [makeMoment(2, 50000), makeMoment(1, 10000)];
    const copy = [...input];
    orderMoments(input);
    expect(input).toEqual(copy);
  });
});
