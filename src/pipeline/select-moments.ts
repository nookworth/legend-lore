import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config, requireConfig } from '../shared/config.js';
import type { Utterance, MomentCandidate } from '../shared/types.js';

const MOMENT_COUNT = 5;

const momentSchema = {
  type: SchemaType.OBJECT,
  properties: {
    moments: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          rank: { type: SchemaType.INTEGER },
          start_time: { type: SchemaType.INTEGER },
          end_time: { type: SchemaType.INTEGER },
          summary: { type: SchemaType.STRING },
          transcript_excerpt: { type: SchemaType.STRING },
          category: {
            type: SchemaType.STRING,
            enum: ['combat', 'roleplay', 'comedy', 'dramatic', 'epic'],
          },
          reasoning: { type: SchemaType.STRING },
        },
        required: ['rank', 'start_time', 'end_time', 'summary', 'transcript_excerpt', 'category', 'reasoning'],
      },
    },
  },
  required: ['moments'],
};

export async function selectMoments(
  utterances: Utterance[],
  campaignContext: string,
): Promise<MomentCandidate[]> {
  requireConfig(['geminiApiKey']);

  const genai = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genai.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: momentSchema,
    },
  });

  const transcriptText = utterances
    .map((u) => `[${formatTime(u.start)}] ${u.speaker}: ${u.text}`)
    .join('\n');

  const prompt = `You are a highlight reel curator for a D&D campaign. Analyze this session transcript and identify the ${MOMENT_COUNT} most clip-worthy moments.

Campaign context:
${campaignContext}

Transcript (timestamps in milliseconds):
${transcriptText}

Select moments that would make compelling short video clips (15-60 seconds). Prioritize:
- Dramatic combat turns or near-deaths
- Funny out-of-character moments or table banter
- Significant roleplay or character development
- Epic reveals or plot twists
- Memorable one-liners

For each moment, provide a start_time and end_time that captures enough context (at minimum 10 seconds of surrounding dialogue). Times must be in milliseconds, matching timestamps in the transcript.

Return exactly ${MOMENT_COUNT} moments ranked 1 (best) to ${MOMENT_COUNT}.`;

  console.log(`[select-moments] Calling Gemini for moment selection (${utterances.length} utterances)...`);

  const result = await model.generateContent(prompt);
  const json = JSON.parse(result.response.text()) as { moments: MomentCandidate[] };

  console.log(`[select-moments] Selected ${json.moments.length} moments`);
  json.moments.forEach((m) => {
    console.log(`  [${m.rank}] ${m.category}: ${m.summary}`);
  });

  return json.moments;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
