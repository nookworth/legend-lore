import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { config, requireConfig } from '../../shared/config.js';
import type { VideoOptions } from '../../shared/types.js';
import type { VideoProvider } from './interface.js';

const MODEL = 'veo-3.1-fast-generate-preview';
const POLL_INTERVAL_MS = 15_000;

const SANITIZE_SYSTEM_INSTRUCTION = `You rewrite video generation prompts to pass content safety filters.
Replace any language describing violence, death, killing, harm, or sexual content with visually equivalent but safe alternatives.
Examples: "kills enemies" → "sends enemies flying back", "death" → "defeat", "wiping out" → "scattering", "blood" → "sparks of magical energy", "seductive" → "alluring", "undressed" → "in flowing robes".
Preserve all visual details (colours, lighting, geometry, environment). Return only the rewritten prompt, no explanation.`;

export class VeoProvider implements VideoProvider {
  private client: GoogleGenAI;
  private gemini: GoogleGenAI;
  private storage: Storage;

  constructor() {
    requireConfig(['gcsBucketVideos', 'gcpProject', 'gcpLocation', 'geminiApiKey']);
    this.client = new GoogleGenAI({
      vertexai: true,
      project: config.gcpProject,
      location: config.gcpLocation,
    });
    this.gemini = new GoogleGenAI({ apiKey: config.geminiApiKey });
    this.storage = new Storage();
  }

  private async sanitizePrompt(prompt: string): Promise<string> {
    const result = await this.gemini.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
      config: { systemInstruction: SANITIZE_SYSTEM_INSTRUCTION },
    });
    const sanitized = result.text?.trim() ?? prompt;
    if (sanitized !== prompt) {
      console.log(`[veo] Sanitized prompt: "${sanitized.slice(0, 100)}..."`);
    }
    return sanitized;
  }

  async generate(prompt: string, options: VideoOptions = {}): Promise<string> {
    const outputGcsUri = `gs://${config.gcsBucketVideos}/veo-clips/`;
    const sanitized = await this.sanitizePrompt(prompt);
    console.log(`[veo] Generating video: "${sanitized.slice(0, 80)}..."`);

    let referenceImages: object[] | undefined;
    if (options.referenceImagePath) {
      const ext = path.extname(options.referenceImagePath).toLowerCase().slice(1);
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const imageBytes = (await readFile(options.referenceImagePath)).toString('base64');
      referenceImages = [{ image: { imageBytes, mimeType }, referenceType: 'asset' }];
      console.log(`[veo] Using reference image: ${options.referenceImagePath}`);
    }

    let operation = await this.client.models.generateVideos({
      model: MODEL,
      prompt: sanitized,
      config: {
        aspectRatio: '16:9',
        outputGcsUri,
        ...(referenceImages && { referenceImages }),
      },
    });

    console.log(`[veo] Operation started, polling every ${POLL_INTERVAL_MS / 1000}s...`);
    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      operation = await this.client.operations.getVideosOperation({ operation });
    }

    const filtered = operation.response?.raiMediaFilteredCount;
    if (filtered && filtered > 0) {
      console.warn(`[veo] Content filtered (${operation.response?.raiMediaFilteredReasons?.[0]})`);
      console.warn('[veo] Retrying with safe fallback prompt...');
      return this.generate('Fantasy landscape, sweeping vista, magical atmosphere, cinematic, Dragonlance setting. No text, no subtitles.', options);
    }

    const gcsUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!gcsUri) {
      console.error('[veo] Unexpected response structure:', JSON.stringify(operation, null, 2));
      throw new Error(`Veo operation completed but no video URI in response`);
    }

    console.log(`[veo] Video ready at ${gcsUri}`);
    return this.downloadFromGcs(gcsUri, options.outputDir ?? '/tmp');
  }

  private async downloadFromGcs(gcsUri: string, outputDir: string): Promise<string> {
    // gcsUri format: gs://bucket-name/path/to/file.mp4
    const withoutScheme = gcsUri.replace('gs://', '');
    const slashIndex = withoutScheme.indexOf('/');
    const bucket = withoutScheme.slice(0, slashIndex);
    const filePath = withoutScheme.slice(slashIndex + 1);

    const localPath = path.join(outputDir, `clip_${Date.now()}.mp4`);
    console.log(`[veo] Downloading ${gcsUri} → ${localPath}`);

    const readStream = this.storage.bucket(bucket).file(filePath).createReadStream();
    await pipeline(readStream, createWriteStream(localPath));

    console.log(`[veo] Video saved → ${localPath}`);
    return localPath;
  }
}
