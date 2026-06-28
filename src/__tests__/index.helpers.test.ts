import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatTime, formatUtteranceWindow, formatCampaignContext, extractCharacterAvatars, extractCharactersForPortrait } from '../pipeline/index.js';
import type { Utterance } from '../shared/types.js';

const campaignJson = readFileSync(join(__dirname, '__fixtures__/campaign.json'), 'utf-8');

describe('formatTime', () => {
  it('converts ms to H:MM:SS', () => {
    expect(formatTime(0)).toBe('0:00:00');
    expect(formatTime(1000)).toBe('0:00:01');
    expect(formatTime(60000)).toBe('0:01:00');
    expect(formatTime(3600000)).toBe('1:00:00');
    expect(formatTime(3661000)).toBe('1:01:01');
  });

  it('handles large values', () => {
    expect(formatTime(7200000)).toBe('2:00:00');
  });
});

describe('formatUtteranceWindow', () => {
  const utterances: Utterance[] = [
    { speaker: 'alice', text: 'hello', start: 0, end: 1000 },
    { speaker: 'bob', text: 'hi', start: 5000, end: 6000 },
    { speaker: 'alice', text: 'long', start: 10000, end: 15000 },
  ];

  it('filters utterances within window from start', () => {
    const result = formatUtteranceWindow(utterances, 6000);
    expect(result).toContain('[0:00:00] alice: hello');
    expect(result).toContain('[0:00:05] bob: hi');
    expect(result).not.toContain('[0:00:10]');
  });

  it('filters utterances within window from end', () => {
    const result = formatUtteranceWindow(utterances, 6000, true);
    expect(result).toContain('[0:00:10] alice: long');
    expect(result).not.toContain('[0:00:00]');
  });

  it('returns empty string for empty utterances', () => {
    expect(formatUtteranceWindow([], 5000)).toBe('');
  });

  it('handles utterances without end field', () => {
    const utts: Utterance[] = [
      { speaker: 'alice', text: 'point', start: 1000 },
    ];
    const result = formatUtteranceWindow(utts, 5000);
    expect(result).toContain('[0:00:01] alice: point');
  });
});

describe('formatCampaignContext', () => {
  it('formats campaign context from JSON', () => {
    const result = formatCampaignContext(campaignJson);
    expect(result).toContain('Campaign: Dragon Lance');
    expect(result).toContain('Characters:');
    expect(result).toContain('Goibniu (Dwarf Cleric (Twilight Domain (TCoE)))');
    expect(result).toContain('Soren (Custom Lineage Barbarian (Path of the Totem Warrior))');
    expect(result).toContain('Appearance:');
    expect(result).toContain('Spells:');
    expect(result).toContain('Personality:');
  });

  it('formats minimal campaign gracefully', () => {
    const result = formatCampaignContext(JSON.stringify({ campaign: 'Minimal', characters: [{ name: 'Test', race: 'Human', classes: [] }] }));
    expect(result).toContain('Campaign: Minimal');
    expect(result).toContain('- Test (Human');
  });
});

describe('extractCharacterAvatars', () => {
  it('extracts all characters with avatars', () => {
    const result = extractCharacterAvatars(campaignJson);
    expect(result).toHaveLength(6);
    expect(result[0]!).toEqual({
      name: 'Goibniu',
      avatarUrl: 'https://www.dndbeyond.com/avatars/55286/727/1581111423-33637295.jpeg?width=150&height=150&fit=crop&quality=95&auto=webp',
    });
  });

  it('returns empty array when no characters have avatars', () => {
    const result = extractCharacterAvatars(JSON.stringify({ campaign: 'Test', characters: [{ name: 'NoAvatar', race: 'Elf', classes: [] }] }));
    expect(result).toEqual([]);
  });

  it('returns empty array for empty characters', () => {
    const result = extractCharacterAvatars(JSON.stringify({ campaign: 'Test', characters: [] }));
    expect(result).toEqual([]);
  });
});

describe('extractCharactersForPortrait', () => {
  it('extracts all characters with avatars', () => {
    const result = extractCharactersForPortrait(campaignJson);
    expect(result).toHaveLength(6);
  });

  it('extracts correct portrait data for Goibniu', () => {
    const result = extractCharactersForPortrait(campaignJson);
    const goibniu = result.find((c) => c.name === 'Goibniu')!;
    expect(goibniu).toBeDefined();
    expect(goibniu.race).toBe('Dwarf');
    expect(goibniu.classes).toBe('Cleric (Twilight Domain (TCoE))');
    expect(goibniu.alignment).toBe('Neutral Good');
    expect(goibniu.equipment).toContain('Longsword');
  });

  it('includes physical details when present', () => {
    const result = extractCharactersForPortrait(campaignJson);
    const aria = result.find((c) => c.name === 'Aria Mao')!;
    expect(aria).toBeDefined();
    expect(aria.age).toBe(23);
    expect(aria.height).toBe("5'2");
    expect(aria.hair).toBe('Black');
    expect(aria.eyes).toBe('Brown');
  });

  it('excludes characters without avatar', () => {
    const noAvatarJson = JSON.stringify({
      campaign: 'Test',
      characters: [
        { name: 'WithAvatar', race: 'Human', classes: [], avatar: 'https://example.com/a.png' },
        { name: 'NoAvatar', race: 'Elf', classes: [], avatar: null },
      ],
    });
    const result = extractCharactersForPortrait(noAvatarJson);
    expect(result.find((c) => c.name === 'NoAvatar')).toBeUndefined();
    expect(result.find((c) => c.name === 'WithAvatar')).toBeDefined();
  });
});
