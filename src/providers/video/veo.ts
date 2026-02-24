import path from 'node:path';
import type { VideoOptions } from '../../shared/types.js';
import type { VideoProvider } from './interface.js';

// TODO: implement Veo via Vertex AI SDK
// Model: veo-3.1-fast (~$0.15/sec, 1080p, native audio)
export class VeoProvider implements VideoProvider {
  async generate(_prompt: string, _options: VideoOptions = {}): Promise<string> {
    throw new Error('Veo provider not yet implemented. Set VIDEO_PROVIDER=replicate.');
  }
}
