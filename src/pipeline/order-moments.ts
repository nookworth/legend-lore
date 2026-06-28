import type { MomentCandidate } from '../shared/types.js';

export function orderMoments(moments: MomentCandidate[]): MomentCandidate[] {
  const sorted = [...moments].sort((a, b) => a.rank - b.rank);
  const top3 = sorted.slice(0, 3).sort((a, b) => a.start_time - b.start_time);
  return [...top3, ...sorted.slice(3)];
}
