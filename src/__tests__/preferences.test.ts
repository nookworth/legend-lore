import { describe, it, expect } from 'vitest';
import { splitPreferences, appendCandidates } from '../feedback/preferences.js';

describe('splitPreferences', () => {
  it('splits at the Pending review marker', () => {
    const md = `- [tone] Keep it upbeat.

## Pending review

- [pacing] Add more combat.`;
    const result = splitPreferences(md);
    expect(result.curated).toBe('- [tone] Keep it upbeat.');
    expect(result.pending).toBe('- [pacing] Add more combat.');
  });

  it('returns all as curated when marker is absent', () => {
    const md = '- [tone] Keep it upbeat.';
    const result = splitPreferences(md);
    expect(result.curated).toBe('- [tone] Keep it upbeat.');
    expect(result.pending).toBe('');
  });

  it('returns empty strings for empty input', () => {
    const result = splitPreferences('');
    expect(result.curated).toBe('');
    expect(result.pending).toBe('');
  });

  it('handles only the marker with no content after', () => {
    const md = '- [tone] Keep it upbeat.\n\n## Pending review';
    const result = splitPreferences(md);
    expect(result.curated).toBe('- [tone] Keep it upbeat.');
    expect(result.pending).toBe('');
  });

  it('handles marker at the very start of the file (no curated content yet)', () => {
    const md = '## Pending review\n\n- [pacing] Add more combat.';
    const result = splitPreferences(md);
    expect(result.curated).toBe('');
    expect(result.pending).toBe('- [pacing] Add more combat.');
  });
});

describe('appendCandidates', () => {
  it('adds a pending block when no marker exists', () => {
    const md = '- [tone] Keep it upbeat.';
    const result = appendCandidates(md, '- [pacing] Add more combat.');
    expect(result).toContain('- [tone] Keep it upbeat.');
    expect(result).toContain('## Pending review');
    expect(result).toContain('- [pacing] Add more combat.');
  });

  it('replaces the pending block content on subsequent calls', () => {
    const md = '- [tone] Keep it upbeat.\n\n## Pending review\n\n- [old] Old item.';
    const result = appendCandidates(md, '- [pacing] Add more combat.');
    expect(result).toContain('- [tone] Keep it upbeat.');
    expect(result).toContain('## Pending review');
    expect(result).toContain('- [pacing] Add more combat.');
    expect(result).not.toContain('- [old] Old item.');
  });

  it('returns original md when candidatesMd is empty', () => {
    const md = '- [tone] Keep it upbeat.';
    expect(appendCandidates(md, '')).toBe('- [tone] Keep it upbeat.');
  });

  it('returns original md when candidatesMd is whitespace', () => {
    const md = '- [tone] Keep it upbeat.';
    expect(appendCandidates(md, '   ')).toBe('- [tone] Keep it upbeat.');
  });

  it('handles empty existing md', () => {
    const result = appendCandidates('', '- [pacing] Add more combat.');
    expect(result).toContain('## Pending review');
    expect(result).toContain('- [pacing] Add more combat.');
  });
});
