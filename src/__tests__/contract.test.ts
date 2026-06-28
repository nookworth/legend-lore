import { describe, it, expect } from 'vitest';

describe('contract — reachable module exports', () => {
  it('mergeAudio is a function', async () => {
    const mod = await import('../pipeline/merge-audio.js');
    expect(typeof mod.mergeAudio).toBe('function');
  });

  it('uploadAudioFile is a function', async () => {
    const mod = await import('../pipeline/upload-audio.js');
    expect(typeof mod.uploadAudioFile).toBe('function');
  });

  it('transcribe is a function', async () => {
    const mod = await import('../pipeline/transcribe.js');
    expect(typeof mod.transcribe).toBe('function');
  });

  it('ingestTextChat is a function', async () => {
    const mod = await import('../pipeline/ingest-text-chat.js');
    expect(typeof mod.ingestTextChat).toBe('function');
  });

  it('takeRoll is a function', async () => {
    const mod = await import('../pipeline/take-roll.js');
    expect(typeof mod.takeRoll).toBe('function');
  });

  it('selectMoments is a function', async () => {
    const mod = await import('../pipeline/select-moments.js');
    expect(typeof mod.selectMoments).toBe('function');
  });

  it('generatePortraits is a function', async () => {
    const mod = await import('../pipeline/generate-portraits.js');
    expect(typeof mod.generatePortraits).toBe('function');
  });

  it('generateNarrative is a function', async () => {
    const mod = await import('../pipeline/generate-narrative.js');
    expect(typeof mod.generateNarrative).toBe('function');
  });

  it('generateTts is a function', async () => {
    const mod = await import('../pipeline/generate-tts.js');
    expect(typeof mod.generateTts).toBe('function');
  });

  it('stitchVideo is a function', async () => {
    const mod = await import('../pipeline/stitch-video.js');
    expect(typeof mod.stitchVideo).toBe('function');
  });

  it('uploadOutput is a function', async () => {
    const mod = await import('../pipeline/upload-output.js');
    expect(typeof mod.uploadOutput).toBe('function');
  });

  it('deliver is a function', async () => {
    const mod = await import('../pipeline/deliver.js');
    expect(typeof mod.deliver).toBe('function');
  });

  it('runPipeline is a function', async () => {
    const mod = await import('../pipeline/index.js');
    expect(typeof mod.runPipeline).toBe('function');
  });

  it('discordGet is a function', async () => {
    const mod = await import('../shared/discord.js');
    expect(typeof mod.discordGet).toBe('function');
  });

  it('discordPost is a function', async () => {
    const mod = await import('../shared/discord.js');
    expect(typeof mod.discordPost).toBe('function');
  });

  it('botPostMessage is a function', async () => {
    const mod = await import('../shared/discord.js');
    expect(typeof mod.botPostMessage).toBe('function');
  });

  it('filterReplies is a function', async () => {
    const mod = await import('../feedback/collect-replies.js');
    expect(typeof mod.filterReplies).toBe('function');
  });

  it('fetchMessagesAfter is a function', async () => {
    const mod = await import('../feedback/collect-replies.js');
    expect(typeof mod.fetchMessagesAfter).toBe('function');
  });

  it('distillReplies is a function', async () => {
    const mod = await import('../feedback/distill.js');
    expect(typeof mod.distillReplies).toBe('function');
  });

  it('splitPreferences is a function', async () => {
    const mod = await import('../feedback/preferences.js');
    expect(typeof mod.splitPreferences).toBe('function');
  });

  it('appendCandidates is a function', async () => {
    const mod = await import('../feedback/preferences.js');
    expect(typeof mod.appendCandidates).toBe('function');
  });
});
