import type { VideoOptions } from '../../shared/types.js';

export interface VideoProvider {
  generate(prompt: string, options: VideoOptions): Promise<string>; // returns local file path
}
