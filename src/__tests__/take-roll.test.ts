import { describe, it, expect } from 'vitest';
import { normalizeHandle, sessionPlayerMap, takeRoll } from '../pipeline/take-roll.js';

describe('normalizeHandle', () => {
  it('strips numeric prefix', () => {
    expect(normalizeHandle('1-mekjonesy')).toBe('mekjonesy');
  });

  it('strips multi-digit prefix', () => {
    expect(normalizeHandle('12-mekjonesy')).toBe('mekjonesy');
  });

  it('lowercases the result', () => {
    expect(normalizeHandle('1-MekJonesy')).toBe('mekjonesy');
  });

  it('trims whitespace', () => {
    expect(normalizeHandle('1- mekjonesy ')).toBe('mekjonesy');
  });

  it('returns string without prefix as-is (lowercased)', () => {
    expect(normalizeHandle('MekJonesy')).toBe('mekjonesy');
  });
});

describe('sessionPlayerMap', () => {
  it('maps session labels to character names via playerMap', () => {
    const labels = ['1-mekjonesy', '2-saravoss', '3-dungeonmaster'];
    const playerMap = { 'mekjonesy': 'Mek', 'saravoss': 'Sara', 'dungeonmaster': 'DM' };
    expect(sessionPlayerMap(labels, playerMap)).toEqual({
      '1-mekjonesy': 'Mek',
      '2-saravoss': 'Sara',
      '3-dungeonmaster': 'DM',
    });
  });

  it('drops labels with no mapped character', () => {
    const playerMap = { 'mekjonesy': 'Mek' };
    expect(sessionPlayerMap(['1-mekjonesy', '2-guest'], playerMap)).toEqual({
      '1-mekjonesy': 'Mek',
    });
  });

  it('handles empty labels', () => {
    expect(sessionPlayerMap([], { 'mekjonesy': 'Mek' })).toEqual({});
  });

  it('handles empty playerMap', () => {
    expect(sessionPlayerMap(['1-mekjonesy'], {})).toEqual({});
  });
});

describe('takeRoll', () => {
  const playerMap = { 'mekjonesy': 'Mek', 'saravoss': 'Sara', 'dungeonmaster': 'DM' };
  const campaignNames = ['Mek', 'Sara', 'Bob'];

  it('partitions present, absent, nonPlayerHandles', () => {
    const roll = takeRoll(['mekjonesy', 'saravoss', 'dungeonmaster'], playerMap, campaignNames);
    expect(roll.present).toEqual(['Mek', 'Sara']);
    expect(roll.absent).toEqual(['Bob']);
    expect(roll.nonPlayerHandles).toEqual(['dungeonmaster']);
  });

  it('handles prefix drift (different numeric prefix)', () => {
    const roll = takeRoll(['mekjonesy'], playerMap, campaignNames);
    expect(roll.present).toEqual(['Mek']);
    expect(roll.absent).toEqual(['Bob', 'Sara']);
    expect(roll.nonPlayerHandles).toEqual([]);
  });

  it('matches names loosely (case/whitespace insensitive)', () => {
    const roll = takeRoll(['mekjonesy'], { 'mekjonesy': '  mek  ' }, ['Mek', 'Sara']);
    expect(roll.present).toEqual(['Mek']);
  });

  it('treats DM as nonPlayerHandle', () => {
    const roll = takeRoll(['dungeonmaster'], { 'dungeonmaster': 'DM' }, ['Mek']);
    expect(roll.present).toEqual([]);
    expect(roll.nonPlayerHandles).toEqual(['dungeonmaster']);
  });

  it('treats guest as nonPlayerHandle', () => {
    const roll = takeRoll(['guest_alex'], {}, ['Mek']);
    expect(roll.present).toEqual([]);
    expect(roll.absent).toEqual(['Mek']);
    expect(roll.nonPlayerHandles).toEqual(['guest_alex']);
  });

  it('all present — empty absent', () => {
    const roll = takeRoll(['mekjonesy', 'saravoss'], playerMap, ['Mek', 'Sara']);
    expect(roll.present).toEqual(['Mek', 'Sara']);
    expect(roll.absent).toEqual([]);
    expect(roll.nonPlayerHandles).toEqual([]);
  });

  it('no matching handles — all absent', () => {
    const roll = takeRoll(['unknown'], {}, ['Mek']);
    expect(roll.present).toEqual([]);
    expect(roll.absent).toEqual(['Mek']);
    expect(roll.nonPlayerHandles).toEqual(['unknown']);
  });

  it('empty handles', () => {
    const roll = takeRoll([], playerMap, ['Mek']);
    expect(roll.present).toEqual([]);
    expect(roll.absent).toEqual(['Mek']);
    expect(roll.nonPlayerHandles).toEqual([]);
  });

  it('empty campaign names', () => {
    const roll = takeRoll(['mekjonesy'], playerMap, []);
    expect(roll.present).toEqual([]);
    expect(roll.absent).toEqual([]);
    expect(roll.nonPlayerHandles).toEqual(['mekjonesy']);
  });
});
