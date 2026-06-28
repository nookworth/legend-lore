import { describe, it, expect } from 'vitest';
import { buildDistillPrompt, renderCandidates } from '../feedback/distill.js';
import type { PreferenceItem } from '../feedback/distill.js';

describe('buildDistillPrompt', () => {
  it('includes replies in the prompt', () => {
    const replies = [
      { author: 'alice', text: 'More combat! ' },
      { author: 'bob', text: 'Less roleplay please.' },
    ];
    const prompt = buildDistillPrompt(replies, '');
    expect(prompt).toContain('alice: More combat!');
    expect(prompt).toContain('bob: Less roleplay please.');
  });

  it('includes existing curated preferences when present', () => {
    const replies = [{ author: 'alice', text: 'Great recap' }];
    const prompt = buildDistillPrompt(replies, '- [tone] Keep it upbeat');
    expect(prompt).toContain('Existing curated preferences');
    expect(prompt).toContain('- [tone] Keep it upbeat');
  });

  it('omits existing section when curated is empty', () => {
    const replies = [{ author: 'alice', text: 'Great recap' }];
    const prompt = buildDistillPrompt(replies, '');
    expect(prompt).not.toContain('Existing curated preferences');
  });

  it('handles empty replies gracefully', () => {
    const prompt = buildDistillPrompt([], '');
    expect(prompt).toContain('Player replies:');
  });
});

describe('renderCandidates', () => {
  it('renders items as markdown bullets', () => {
    const items: PreferenceItem[] = [
      { category: 'tone', guidance: 'Keep narration upbeat.' },
      { category: 'pacing', guidance: 'Show more combat highlights.' },
    ];
    expect(renderCandidates(items)).toBe(
      '- [tone] Keep narration upbeat.\n- [pacing] Show more combat highlights.',
    );
  });

  it('returns empty string for empty items', () => {
    expect(renderCandidates([])).toBe('');
  });

  it('handles single item', () => {
    const items: PreferenceItem[] = [
      { category: 'music', guidance: 'Use epic music.' },
    ];
    expect(renderCandidates(items)).toBe('- [music] Use epic music.');
  });
});
