import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Narrative } from '../shared/types.js';

const execFileAsync = promisify(execFile);

interface StitchInput {
  type: 'narration' | 'clip';
  videoPath?: string;    // for clips
  imagePath?: string;    // for narration title cards (Gemini illustration)
  audioPath?: string;    // for narration (.mp3)
  text?: string;         // overlay text for narration cards
  durationSecs?: number; // for narration cards (derived from audio duration)
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ]);
  return parseFloat(stdout.trim());
}

export async function stitchVideo(
  narrative: Narrative,
  narrationPaths: string[],
  videoPaths: string[],
  outputPath: string,
  tmpDir: string,
): Promise<string> {
  // narrationPaths: [intro, bridge_0, bridge_1, ..., outro]
  // videoPaths: [clip_1, clip_2, clip_3]
  // Structure: intro → clip1 → bridge0 → clip2 → bridge1 → clip3 → outro

  const allSegments: string[] = [];

  const narrationSegments = [narrative.intro, ...narrative.bridges, narrative.outro];
  const narrationLabels = [
    'intro',
    ...narrative.bridges.map((_, i) => `bridge_${i}`),
    'outro',
  ];

  // Build narration title card segments
  const titleCardPaths: string[] = [];
  for (let i = 0; i < narrationSegments.length; i++) {
    const seg = narrationSegments[i]!;
    const label = narrationLabels[i]!;
    const audioPath = narrationPaths[i]!;
    const imagePath = path.join(tmpDir, `narrative_${label}.png`);

    // Write illustration if not already there
    await writeFile(imagePath, seg.image);

    const duration = await getAudioDuration(audioPath);
    const titleCardPath = path.join(tmpDir, `titlecard_${label}.mp4`);

    // Create title card: image + audio + text overlay
    const safeText = (seg.text ?? '').replace(/'/g, "'\\''").slice(0, 200);
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop', '1', '-i', imagePath,
      '-i', audioPath,
      '-filter_complex',
      `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,` +
      `drawtext=text='${safeText}':fontsize=28:fontcolor=white:bordercolor=black:borderw=2:` +
      `x=(w-text_w)/2:y=h-th-40:line_spacing=8:expansion=none[v]`,
      '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-c:a', 'aac',
      '-t', String(duration),
      '-pix_fmt', 'yuv420p',
      titleCardPath,
    ]);

    titleCardPaths.push(titleCardPath);
    allSegments.push(titleCardPath);

    // Interleave video clip after each non-outro narration segment
    const clipPath = videoPaths[i];
    if (clipPath && i < videoPaths.length) {
      // Re-encode clip to consistent 1280x720 + aac for concat compatibility
      const normalizedClipPath = path.join(tmpDir, `clip_normalized_${i}.mp4`);
      await execFileAsync('ffmpeg', [
        '-y', '-i', clipPath,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720',
        '-c:v', 'libx264', '-c:a', 'aac',
        '-pix_fmt', 'yuv420p',
        normalizedClipPath,
      ]);
      allSegments.push(normalizedClipPath);
    }
  }

  // Write concat list file
  const concatListPath = path.join(tmpDir, 'concat_list.txt');
  const concatContent = allSegments.map((p) => `file '${p}'`).join('\n');
  await writeFile(concatListPath, concatContent);

  // Concat all segments
  console.log(`[stitch] Concatenating ${allSegments.length} segments → ${outputPath}`);
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-c', 'copy',
    outputPath,
  ]);

  console.log(`[stitch] Final video → ${outputPath}`);
  return outputPath;
}
