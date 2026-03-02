import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.mp3', '.wav', '.m4a', '.ogg']);

// Channel layouts and their corresponding label sequences for the ffmpeg join
// filter map parameter. Labels must exactly match the slots in each layout —
// layouts without LFE (all except 7.1) must not include it.
const CHANNEL_CONFIG: Record<number, { layout: string; labels: string[] }> = {
  1: { layout: 'mono',   labels: ['FC'] },
  2: { layout: 'stereo', labels: ['FL', 'FR'] },
  3: { layout: '3.0',    labels: ['FL', 'FR', 'FC'] },
  4: { layout: '4.0',    labels: ['FL', 'FR', 'BL', 'BR'] },
  5: { layout: '5.0',    labels: ['FL', 'FR', 'FC', 'BL', 'BR'] },
  6: { layout: '6.0',    labels: ['FL', 'FR', 'FC', 'BL', 'BR', 'BC'] },
  7: { layout: '7.0',    labels: ['FL', 'FR', 'FC', 'BL', 'BR', 'SL', 'SR'] },
  8: { layout: '7.1',    labels: ['FL', 'FR', 'FC', 'LFE', 'BL', 'BR', 'SL', 'SR'] },
};

export interface MergeAudioResult {
  outputPath: string;
  channelMap: Record<number, string>; // channel index → speaker name (from filename)
}

export async function mergeAudio(audioDir: string, outputPath: string): Promise<MergeAudioResult> {
  const files = await readdir(audioDir);
  const audioFiles = files
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort(); // alphabetical → deterministic channel-to-speaker mapping

  if (audioFiles.length === 0) {
    throw new Error(`No audio files found in ${audioDir}`);
  }

  const channelMap: Record<number, string> = {};
  audioFiles.forEach((f, i) => {
    channelMap[i] = path.basename(f, path.extname(f));
  });

  if (audioFiles.length === 1) {
    // Single file — just copy, no merge needed
    const { execFile: ef } = await import('node:child_process');
    const efAsync = promisify(ef);
    await efAsync('ffmpeg', ['-y', '-i', path.join(audioDir, audioFiles[0]!), '-c:a', 'aac', outputPath]);
    return { outputPath, channelMap };
  }

  const channelConfig = CHANNEL_CONFIG[audioFiles.length];
  if (!channelConfig) {
    throw new Error(`Unsupported channel count: ${audioFiles.length} (max 8)`);
  }
  const { layout, labels } = channelConfig;

  // Build ffmpeg args with explicit map parameter to strictly isolate each input
  // into its own output channel. Without map=, the join filter can bleed audio
  // across channels, causing AssemblyAI to return duplicate utterances.
  const inputs = audioFiles.flatMap((f) => ['-i', path.join(audioDir, f)]);
  const filterInputs = audioFiles.map((_, i) => `[${i}:a]`).join('');
  const mapEntries = audioFiles.map((_, i) => `${i}.0-${labels[i]}`).join('|');
  const filterComplex = `${filterInputs}join=inputs=${audioFiles.length}:channel_layout=${layout}:map=${mapEntries}`;

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-c:a', 'aac',
    outputPath,
  ];

  console.log(`[merge-audio] Merging ${audioFiles.length} tracks → ${outputPath}`);
  console.log(`[merge-audio] Channel map:`, channelMap);

  const { stderr } = await execFileAsync('ffmpeg', args);
  if (stderr) console.log('[merge-audio] ffmpeg:', stderr.slice(-500));

  return { outputPath, channelMap };
}
