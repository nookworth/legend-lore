import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { messagesToUtterances, parseRecordingInfo } from '../pipeline/ingest-text-chat.js';

const FIXTURES_DIR = join(__dirname, '__fixtures__');

describe('messagesToUtterances', () => {
  const recordingStartMs = new Date('2024-03-15T19:00:00.000Z').getTime();
  const playerMap = { 'mekjonesy': 'Mek', 'saravoss': 'Sara' };

  function makeMsg(username: string, content: string, tsDeltaMs: number) {
    return {
      id: String(Math.random()),
      content,
      timestamp: new Date(recordingStartMs + tsDeltaMs).toISOString(),
      author: { id: '1', username, bot: false },
    };
  }

  it('drops bot messages', () => {
    const msgs = [{
      id: '1', content: 'hello', timestamp: new Date(recordingStartMs + 1000).toISOString(),
      author: { id: '2', username: 'bot_user', bot: true },
    }];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toEqual([]);
    expect(result.handles).toEqual([]);
  });

  it('drops empty messages', () => {
    const msgs = [makeMsg('mekjonesy', '   ', 1000)];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toEqual([]);
  });

  it('drops command messages starting with ! or /', () => {
    const msgs = [makeMsg('mekjonesy', '!roll', 1000), makeMsg('mekjonesy', '/help', 2000)];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toEqual([]);
  });

  it('drops messages from unmapped authors', () => {
    const msgs = [makeMsg('unknown_user', 'hello', 1000)];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toEqual([]);
  });

  it('drops messages with start < 0', () => {
    const msgs = [makeMsg('mekjonesy', 'hello', -1000)];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toEqual([]);
  });

  it('converts valid messages to utterances', () => {
    const msgs = [
      makeMsg('mekjonesy', 'Hello everyone!', 5000),
      makeMsg('saravoss', 'Hi Mek!', 8000),
    ];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toHaveLength(2);
    expect(result.utterances[0]).toEqual({ speaker: 'mekjonesy', text: 'Hello everyone!', start: 5000 });
    expect(result.utterances[1]).toEqual({ speaker: 'saravoss', text: 'Hi Mek!', start: 8000 });
    expect(result.handles).toEqual(['mekjonesy', 'saravoss']);
  });

  it('deduplicates handles', () => {
    const msgs = [
      makeMsg('mekjonesy', 'First', 1000),
      makeMsg('mekjonesy', 'Second', 2000),
    ];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.handles).toEqual(['mekjonesy']);
  });

  it('omits end field', () => {
    const msgs = [makeMsg('mekjonesy', 'hello', 1000)];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances[0]).not.toHaveProperty('end');
  });

  it('matches handles case-insensitively', () => {
    const msgs = [makeMsg('MekJonesy', 'hello', 1000)];
    const result = messagesToUtterances(msgs, recordingStartMs, playerMap);
    expect(result.utterances).toHaveLength(1);
  });

  it('handles empty messages array', () => {
    const result = messagesToUtterances([], recordingStartMs, playerMap);
    expect(result.utterances).toEqual([]);
    expect(result.handles).toEqual([]);
  });
});

describe('parseRecordingInfo', () => {
  it('parses a real Craig info.txt from the fixture', async () => {
    const info = await parseRecordingInfo(FIXTURES_DIR);
    expect(info).not.toBeNull();
    expect(info!.startTime.toISOString()).toBe('2026-06-20T01:55:53.382Z');
    expect(info!.channelId).toBe('1083239745531949100');
    expect(info!.guildId).toBe('1083239745070579712');
  });

  it('returns null for missing file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-test-'));
    const info = await parseRecordingInfo(dir);
    expect(info).toBeNull();
  });

  it('returns null for unparseable content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-test-'));
    writeFileSync(join(dir, 'info.txt'), 'garbage content');
    const info = await parseRecordingInfo(dir);
    expect(info).toBeNull();
  });

  it('returns null when start time is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-test-'));
    writeFileSync(join(dir, 'info.txt'), 'Channel: general (1234)');
    const info = await parseRecordingInfo(dir);
    expect(info).toBeNull();
  });

  it('parses info with only start time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'll-test-'));
    writeFileSync(join(dir, 'info.txt'), 'Start time: 2024-03-15T19:00:00.000Z');
    const info = await parseRecordingInfo(dir);
    expect(info).not.toBeNull();
    expect(info!.startTime.toISOString()).toBe('2024-03-15T19:00:00.000Z');
    expect(info!.channelId).toBeUndefined();
    expect(info!.guildId).toBeUndefined();
  });
});
