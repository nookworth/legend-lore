import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Narrative } from '../shared/types.js';

const execFileAsync = promisify(execFile);

export async function stitchVideo(
  narrative: Narrative,
  narrationPaths: string[],
  outputPath: string,
  tmpDir: string,
): Promise<string> {
  const allSegments: string[] = [];

  for (let i = 0; i < narrative.length; i++) {
    const seg = narrative[i]!;
    const audioPath = narrationPaths[i]!;
    const imagePath = path.join(tmpDir, `narrative_${seg.label}.png`);
    const titleCardPath = path.join(tmpDir, `titlecard_${seg.label}.mp4`);

    await writeFile(imagePath, seg.image);

    await execFileAsync('ffmpeg', [
      '-y',
      '-loop', '1', '-i', imagePath,
      '-i', audioPath,
      '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720',
      '-c:v', 'libx264', '-c:a', 'aac',
      '-shortest',
      '-pix_fmt', 'yuv420p',
      titleCardPath,
    ]);

    allSegments.push(titleCardPath);
  }

  // Write concat list
  const concatListPath = path.join(tmpDir, 'concat_list.txt');
  await writeFile(concatListPath, allSegments.map((p) => `file '${path.resolve(p)}'`).join('\n'));

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
