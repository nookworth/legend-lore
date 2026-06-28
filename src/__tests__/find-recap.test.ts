import { describe, it, expect } from 'vitest';
import { pickLatestSessionWithRecap } from '../feedback/find-recap.js';
import type { SessionEntry } from '../feedback/find-recap.js';

describe('pickLatestSessionWithRecap', () => {
  it('picks the most recent session with a recap', () => {
    const entries: SessionEntry[] = [
      { name: '2024-01-01', hasRecap: true },
      { name: '2024-01-03', hasRecap: true },
      { name: '2024-01-02', hasRecap: true },
    ];
    expect(pickLatestSessionWithRecap(entries)?.name).toBe('2024-01-03');
  });

  it('skips directories without recap_message.json', () => {
    const entries: SessionEntry[] = [
      { name: '2024-01-01', hasRecap: false },
      { name: '2024-01-03', hasRecap: true },
      { name: '2024-01-02', hasRecap: false },
    ];
    expect(pickLatestSessionWithRecap(entries)?.name).toBe('2024-01-03');
  });

  it('returns null when no session has a recap', () => {
    const entries: SessionEntry[] = [
      { name: '2024-01-01', hasRecap: false },
      { name: '2024-01-02', hasRecap: false },
    ];
    expect(pickLatestSessionWithRecap(entries)).toBeNull();
  });

  it('returns null for empty list', () => {
    expect(pickLatestSessionWithRecap([])).toBeNull();
  });

  it('handles a single session with recap', () => {
    const entries: SessionEntry[] = [
      { name: '2024-06-15', hasRecap: true },
    ];
    expect(pickLatestSessionWithRecap(entries)?.name).toBe('2024-06-15');
  });
});
