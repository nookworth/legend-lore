import { AssemblyAI } from 'assemblyai';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, requireConfig } from '../shared/config.js';
import type { Utterance } from '../shared/types.js';

export interface TranscribeResult {
  utterances: Utterance[];
  transcriptText: string;
  rawResponsePath: string;
}

export async function transcribe(
  audioPath: string,
  channelMap: Record<number, string>,
  outputDir: string,
): Promise<TranscribeResult> {
  requireConfig(['assemblyAiApiKey']);

  const client = new AssemblyAI({ apiKey: config.assemblyAiApiKey });

  console.log(`[transcribe] Submitting ${audioPath} to AssemblyAI...`);

  const transcript = await client.transcripts.transcribe({
    audio: audioPath,
    multichannel: true,
  });

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI transcription failed: ${transcript.error}`);
  }

  // Save raw response
  const rawPath = path.join(outputDir, 'transcript_raw.json');
  await writeFile(rawPath, JSON.stringify(transcript, null, 2));
  console.log(`[transcribe] Raw transcript saved → ${rawPath}`);

  // Parse utterances — map channel numbers to speaker names via channelMap
  const utterances: Utterance[] = (transcript.utterances ?? []).map((u) => ({
    speaker: channelMap[Number(u.channel) - 1] ?? `channel_${u.channel}`,
    text: u.words?.map((w) => w.text).join(' ') ?? u.text ?? '',
    start: u.start ?? 0,
    end: u.end ?? 0,
  }));

  // Build plain-text transcript for LLM consumption
  const transcriptText = utterances
    .map((u) => `[${u.speaker}] ${u.text}`)
    .join('\n');

  const parsedPath = path.join(outputDir, 'utterances.json');
  await writeFile(parsedPath, JSON.stringify(utterances, null, 2));
  console.log(`[transcribe] Parsed ${utterances.length} utterances → ${parsedPath}`);

  return { utterances, transcriptText, rawResponsePath: rawPath };
}
