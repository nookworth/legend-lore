import { describe, it, expect } from 'vitest';

describe('contract — reachable module exports', () => {
  it('mergeAudio is a function', async () => {
    const mod = await import('./merge-audio.js');
    expect(typeof mod.mergeAudio).toBe('function');
  });

  it('uploadAudioFile is a function', async () => {
    const mod = await import('./upload-audio.js');
    expect(typeof mod.uploadAudioFile).toBe('function');
  });

  it('transcribe is a function', async () => {
    const mod = await import('./transcribe.js');
    expect(typeof mod.transcribe).toBe('function');
  });

  it('ingestTextChat is a function', async () => {
    const mod = await import('./ingest-text-chat.js');
    expect(typeof mod.ingestTextChat).toBe('function');
  });

  it('takeRoll is a function', async () => {
    const mod = await import('./take-roll.js');
    expect(typeof mod.takeRoll).toBe('function');
  });

  it('selectMoments is a function', async () => {
    const mod = await import('./select-moments.js');
    expect(typeof mod.selectMoments).toBe('function');
  });

  it('generatePortraits is a function', async () => {
    const mod = await import('./generate-portraits.js');
    expect(typeof mod.generatePortraits).toBe('function');
  });

  it('generateNarrative is a function', async () => {
    const mod = await import('./generate-narrative.js');
    expect(typeof mod.generateNarrative).toBe('function');
  });

  it('generateTts is a function', async () => {
    const mod = await import('./generate-tts.js');
    expect(typeof mod.generateTts).toBe('function');
  });

  it('stitchVideo is a function', async () => {
    const mod = await import('./stitch-video.js');
    expect(typeof mod.stitchVideo).toBe('function');
  });

  it('uploadOutput is a function', async () => {
    const mod = await import('./upload-output.js');
    expect(typeof mod.uploadOutput).toBe('function');
  });

  it('deliver is a function', async () => {
    const mod = await import('./deliver.js');
    expect(typeof mod.deliver).toBe('function');
  });

  it('runPipeline is a function', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.runPipeline).toBe('function');
  });
});
