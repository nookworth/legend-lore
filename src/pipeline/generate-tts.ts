import textToSpeech from '@google-cloud/text-to-speech';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Narrative } from '../shared/types.js';

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')        // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')     // italic
    .replace(/__(.+?)__/g, '$1')     // bold (underscore)
    .replace(/_(.+?)_/g, '$1')       // italic (underscore)
    .replace(/`+([^`]+)`+/g, '$1')  // code
    .replace(/^[-*+]\s+/gm, '')      // unordered list markers
    .replace(/^\d+\.\s+/gm, '')      // ordered list markers
    .replace(/^>\s*/gm, '')          // blockquotes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label only
    .replace(/\n{3,}/g, '\n\n')      // collapse excess blank lines
    .trim();
}

// Deep, dramatic voice for fantasy narration
const VOICE = {
  languageCode: 'en-US',
  name: 'en-US-Studio-Q',
};

export async function generateTts(narrative: Narrative, outputDir: string): Promise<string[]> {
  const client = new textToSpeech.TextToSpeechClient();

  const segments = [narrative.intro, ...narrative.bridges, narrative.outro];
  const labels = [
    'narration_intro',
    ...narrative.bridges.map((_, i) => `narration_bridge_${i}`),
    'narration_outro',
  ];

  const outputPaths: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const label = labels[i]!;
    const outputPath = path.join(outputDir, `${label}.mp3`);

    console.log(`[generate-tts] Synthesizing ${label}...`);

    const [response] = await client.synthesizeSpeech({
      input: { text: stripMarkdown(segment.text) },
      voice: VOICE,
      audioConfig: { audioEncoding: 'MP3' },
    });

    if (!response.audioContent) {
      throw new Error(`TTS returned no audio for ${label}`);
    }

    await writeFile(outputPath, response.audioContent as Uint8Array);
    console.log(`[generate-tts] ${label} → ${outputPath}`);
    outputPaths.push(outputPath);
  }

  return outputPaths;
}
