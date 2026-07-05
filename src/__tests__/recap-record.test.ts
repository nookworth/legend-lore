import { describe, it, expect } from 'vitest';
import { upsertRecap, latestRecap } from '../pipeline/recap-record.js';
import type { RecapEntry } from '../pipeline/recap-record.js';

function entry(runId: string, postedAt: string): RecapEntry {
  return { runId, messageId: `msg-${runId}`, channelId: `ch-${runId}`, postedAt };
}

describe('upsertRecap', () => {
  it('appends to empty list', () => {
    const result = upsertRecap([], entry('run1', '2024-01-01T00:00:00Z'));
    expect(result).toHaveLength(1);
    expect(result[0]!.runId).toBe('run1');
  });

  it('appends a new run to an existing list', () => {
    const existing = [entry('run1', '2024-01-01T00:00:00Z')];
    const result = upsertRecap(existing, entry('run2', '2024-01-02T00:00:00Z'));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.runId)).toEqual(['run1', 'run2']);
  });

  it('replaces an existing run by runId', () => {
    const existing = [entry('run1', '2024-01-01T00:00:00Z')];
    const replacement = entry('run1', '2024-01-03T00:00:00Z');
    const result = upsertRecap(existing, replacement);
    expect(result).toHaveLength(1);
    expect(result[0]!.postedAt).toBe('2024-01-03T00:00:00Z');
  });

  it('replaces among multiple entries', () => {
    const existing = [
      entry('run1', '2024-01-01T00:00:00Z'),
      entry('run2', '2024-01-02T00:00:00Z'),
    ];
    const result = upsertRecap(existing, entry('run1', '2024-01-04T00:00:00Z'));
    expect(result).toHaveLength(2);
    expect(result[0]!.postedAt).toBe('2024-01-04T00:00:00Z');
    expect(result[1]!.runId).toBe('run2');
  });

  it('does not mutate the original array', () => {
    const existing = [entry('run1', '2024-01-01T00:00:00Z')];
    const copy = [...existing];
    upsertRecap(existing, entry('run2', '2024-01-02T00:00:00Z'));
    expect(existing).toEqual(copy);
  });
});

describe('latestRecap', () => {
  it('returns the entry with max postedAt', () => {
    const recaps = [
      entry('run1', '2024-01-01T00:00:00Z'),
      entry('run2', '2024-01-03T00:00:00Z'),
      entry('run3', '2024-01-02T00:00:00Z'),
    ];
    expect(latestRecap(recaps)?.runId).toBe('run2');
  });

  it('returns null for empty list', () => {
    expect(latestRecap([])).toBeNull();
  });

  it('returns the only entry for a single-element list', () => {
    expect(latestRecap([entry('run1', '2024-01-01T00:00:00Z')])?.runId).toBe('run1');
  });
});
