import { GoogleGenAI } from '@google/genai';
import { config, requireConfig } from '../shared/config.js';
import type { Reply } from './collect-replies.js';

export interface PreferenceItem {
  category: string;
  guidance: string;
}

const distillSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          guidance: { type: 'string' },
        },
        required: ['category', 'guidance'],
      },
    },
  },
  required: ['items'],
};

export function buildDistillPrompt(
  replies: Reply[],
  existingCurated: string,
): string {
  const existingSection = existingCurated.trim()
    ? `\nAlready-curated preferences (do NOT re-propose these):\n${existingCurated}\n`
    : '';

  return `You are analyzing player feedback on D&D session recaps. Below are text replies from players reacting to the latest recap.

Extract durable, recurring style and content guidance that would improve future recaps. Be conservative:
- Only extract guidance that appears in multiple replies or is stated emphatically.
- Never invent preferences the players did not express.
- Do not re-propose guidance that already appears in the curated preferences list above.
- Categorize each item (e.g. "pacing", "tone", "content-focus", "structure", "voiceover", "music").
- Write each guidance item as a concise, actionable instruction (1-2 sentences).${existingSection}

Player replies:
${replies.map((r) => `- ${r.author}: ${r.text}`).join('\n')}

Return a list of preference items derived strictly from the replies above. If no actionable guidance can be extracted, return an empty list.`;
}

export function renderCandidates(items: PreferenceItem[]): string {
  if (items.length === 0) return '';
  return items
    .map((i) => `- [${i.category}] ${i.guidance}`)
    .join('\n');
}

export async function distillReplies(
  replies: Reply[],
  existingCurated: string,
): Promise<PreferenceItem[]> {
  if (replies.length === 0) return [];
  requireConfig(['geminiApiKey']);

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const prompt = buildDistillPrompt(replies, existingCurated);

  const result = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: distillSchema,
    },
  });

  const json = JSON.parse(result.text ?? '') as { items: PreferenceItem[] };
  return json.items ?? [];
}
