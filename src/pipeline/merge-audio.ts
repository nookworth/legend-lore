import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.mp3', '.wav', '.m4a', '.ogg']);

// Channel layouts by count — used by AssemblyAI multichannel diarization
const CHANNEL_LAYOUTS: Record<number, string> = {
  1: 'mono',
  2: 'stereo',
  3: '3.0',
  4: 'quad',
  5: '5.0',
  6: '5.1',
  7: '6.1',
  8: '7.1',
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

  const layout = CHANNEL_LAYOUTS[audioFiles.length];
  if (!layout) {
    throw new Error(`Unsupported channel count: ${audioFiles.length} (max 8)`);
  }

  // Build ffmpeg args: -i file1 -i file2 ... -filter_complex "join=inputs=N:channel_layout=L" -c:a aac out.m4a
  const inputs = audioFiles.flatMap((f) => ['-i', path.join(audioDir, f)]);
  const filterComplex = `join=inputs=${audioFiles.length}:channel_layout=${layout}`;

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
