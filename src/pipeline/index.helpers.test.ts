import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatTime, formatUtteranceWindow, formatCampaignContext, extractCharacterAvatars, extractCharactersForPortrait } from './index.js';
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
    expect(result).toContain('Campaign: Test Campaign');
    expect(result).toContain('Characters:');
    expect(result).toContain('Mek (Human Fighter (Champion))');
    expect(result).toContain('Sara (Elf Wizard (Evocation))');
    expect(result).toContain('Appearance:');
    expect(result).toContain('Spells:');
    expect(result).toContain('Personality:');
  });

  it('formats minimal campaign gracefully', () => {
    const result = formatCampaignContext(JSON.stringify({ campaign: 'Minimal', characters: [{ name: 'Test', race: 'Human', classes: [] }] }));
    expect(result).toContain('Campaign: Minimal');
    expect(result).toContain('Campaign: Minimal');
    expect(result).toContain('- Test (Human');
  });
});

describe('extractCharacterAvatars', () => {
  it('extracts characters with avatars', () => {
    const result = extractCharacterAvatars(campaignJson);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Mek', avatarUrl: 'https://example.com/avatars/mek.png' });
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
  it('extracts characters with full portrait info', () => {
    const result = extractCharactersForPortrait(campaignJson);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Mek');
    expect(result[0].race).toBe('Human');
    expect(result[0].classes).toBe('Fighter (Champion)');
    expect(result[0].alignment).toBe('Lawful Good');
    expect(result[0].gender).toBe('Male');
    expect(result[0].equipment).toContain('Longsword');
  });

  it('handles missing optional fields', () => {
    const result = extractCharactersForPortrait(campaignJson);
    expect(result[0].age).toBe('30');
    expect(result[0].height).toBe("6'0\"");
  });

  it('excludes characters without avatar', () => {
    const result = extractCharactersForPortrait(campaignJson);
    expect(result.find((c) => c.name === 'Sara')).toBeUndefined();
  });
});
