import { GoogleGenAI } from '@google/genai';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, requireConfig } from '../shared/config.js';
import type { Utterance, MomentCandidate } from '../shared/types.js';

const MOMENT_COUNT = 5;

const momentSchema = {
  type: 'object',
  properties: {
    moments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          start_time: { type: 'integer' },
          end_time: { type: 'integer' },
          summary: { type: 'string' },
          transcript_excerpt: { type: 'string' },
          attributions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                speaker: { type: 'string' },
              },
              required: ['quote', 'speaker'],
            },
          },
          category: {
            type: 'string',
            enum: ['combat', 'roleplay', 'comedy', 'dramatic', 'epic'],
          },
          preceding_events: { type: 'string' },
          reasoning: { type: 'string' },
          visual_description: { type: 'string' },
        },
        required: ['rank', 'start_time', 'end_time', 'summary', 'transcript_excerpt', 'preceding_events', 'category', 'reasoning', 'visual_description'],
      },
    },
  },
  required: ['moments'],
};

export async function selectMoments(
  utterances: Utterance[],
  campaignContext: string,
  outputDir: string,
  playerMap: Record<string, string> = {},
  extraInstructions?: string,
): Promise<MomentCandidate[]> {
  requireConfig(['geminiApiKey']);

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const transcriptText = utterances
    .map((u) => `[${formatTime(u.start)}] ${u.speaker}: ${u.text}`)
    .join('\n');

  const playerMappingEntries = Object.entries(playerMap);
  const playerMappingSection = playerMappingEntries.length
    ? `\nPlayer to character mapping (transcript speaker label → in-game character name):\n${playerMappingEntries.map(([k, v]) => `  ${k} → ${v}`).join('\n')}\n`
    : '';

  const extraSection = extraInstructions?.trim()
    ? `\nADDITIONAL INSTRUCTIONS FOR THIS RUN (operator-provided — prioritize these over the general guidance where they conflict):\n${extraInstructions.trim()}\n`
    : '';

  const prompt = `You are a highlight reel curator for a D&D campaign. Analyze this session transcript and identify the ${MOMENT_COUNT} most clip-worthy moments.

Campaign context:
${campaignContext}
${playerMappingSection}

Transcript (timestamps in milliseconds):
${transcriptText}

Select moments that would make compelling short video clips (15-60 seconds). Prioritize:
- Dramatic combat turns or near-deaths
- Funny out-of-character moments or table banter
- Significant roleplay or character development
- Epic reveals or plot twists
- Memorable one-liners

For each moment, provide a start_time and end_time that captures enough context (at minimum 10 seconds of surrounding dialogue). Times must be in milliseconds, matching timestamps in the transcript.

Keep transcript_excerpt to 1-2 sentences maximum — just the key line(s) that make the moment memorable.

For attributions: if this moment contains any directly quotable lines, list them here — each as a verbatim quote paired with the speaker's in-game character name. Use the player to character mapping above to translate transcript speaker labels to character names. Omit this field if there are no natural quotes worth preserving.

For preceding_events: write 1-2 sentences describing what the party was doing in the transcript immediately before this moment — where they were, what they were in the middle of, how they arrived at this point. Base this strictly on the transcript; do not invent events.

For visual_description: write a single sentence describing only what this moment looks like on screen — spell geometry, lighting, colours, environment, character poses. Focus on visual spectacle, not combat outcomes or game mechanics. This will be used as a video generation prompt, so be specific and cinematic. Example: "A towering cylinder of scarlet and shadow erupts from the earth, sixty feet high, bathing the battlefield in deep crimson light."
${extraSection}
Return exactly ${MOMENT_COUNT} moments ranked 1 (best) to ${MOMENT_COUNT}.`;

  console.log(`[select-moments] Calling Gemini for moment selection (${utterances.length} utterances)...`);

  const result = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: momentSchema,
    },
  });
  const json = JSON.parse(result.text ?? '') as { moments: MomentCandidate[] };

  console.log(`[select-moments] Selected ${json.moments.length} moments`);
  json.moments.forEach((m) => {
    console.log(`  [${m.rank}] ${m.category}: ${m.summary}`);
  });

  const outPath = path.join(outputDir, 'moments.json');
  await writeFile(outPath, JSON.stringify(json.moments, null, 2));
  console.log(`[select-moments] Saved → ${outPath}`);

  return json.moments;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
