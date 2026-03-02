import Replicate from 'replicate';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { config, requireConfig } from '../../shared/config.js';
import type { VideoOptions } from '../../shared/types.js';
import type { VideoProvider } from './interface.js';

// LTX-Video on Replicate
const MODEL = 'lightricks/ltx-video:8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4';

export class ReplicateProvider implements VideoProvider {
  private client: Replicate;

  constructor() {
    requireConfig(['replicateApiToken']);
    this.client = new Replicate({ auth: config.replicateApiToken });
  }

  async generate(prompt: string, options: VideoOptions = {}): Promise<string> {
    console.log(`[replicate] Generating video: "${prompt.slice(0, 80)}..."`);

    const output = await this.client.run(MODEL, {
      input: {
        prompt,
        width: options.width ?? 768,
        height: options.height ?? 512,
        num_frames: 121, // ~5s at 24fps
      },
    });

    // output is a URL string (Replicate output URLs are temporary — download immediately)
    const videoUrl = Array.isArray(output) ? String(output[0]) : String(output);
    const dir = options.outputDir ?? '/tmp';
    const localPath = path.join(dir, `clip_${Date.now()}.mp4`);

    console.log(`[replicate] Downloading video from ${videoUrl}...`);
    const response = await fetch(videoUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Replicate output: ${response.status}`);
    }

    await pipeline(
      response.body as unknown as NodeJS.ReadableStream,
      createWriteStream(localPath),
    );

    console.log(`[replicate] Video saved → ${localPath}`);
    return localPath;
  }
}
