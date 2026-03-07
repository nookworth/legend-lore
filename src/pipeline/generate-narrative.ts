import { GoogleGenAI } from "@google/genai";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config, requireConfig } from "../shared/config.js";
import type {
  MomentCandidate,
  Narrative,
  NarrativeSegment,
} from "../shared/types.js";

const MODEL = "gemini-3.1-flash-image-preview";
const MAX_ATTEMPTS = 3;

export interface CharacterAvatar {
  name: string;
  avatarUrl: string;
}

type InputPart = { text: string } | { inlineData: { mimeType: string; data: string } };

async function fetchAvatarParts(avatars: CharacterAvatar[]): Promise<InputPart[]> {
  if (avatars.length === 0) return [];
  const parts: InputPart[] = [{ text: 'Character reference portraits — use these to accurately depict the characters in all illustrations:' }];
  for (const { name, avatarUrl } of avatars) {
    try {
      const response = await fetch(avatarUrl);
      if (!response.ok) {
        console.warn(`[generate-narrative] Avatar fetch failed for ${name}: ${response.status}`);
        continue;
      }
      const mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      const data = Buffer.from(await response.arrayBuffer()).toString('base64');
      parts.push({ text: `${name}:` }, { inlineData: { mimeType, data } });
      console.log(`[generate-narrative] Loaded avatar for ${name}`);
    } catch (err) {
      console.warn(`[generate-narrative] Could not fetch avatar for ${name}: ${err}`);
    }
  }
  return parts;
}

const SYSTEM_INSTRUCTION = `You are a narrator recapping a D&D session for the players who just finished it.

Narration style rules — follow these strictly:
- Plain prose only. No markdown, asterisks, bullet points, headers, or special characters.
- Be specific. Reference the actual character names, player decisions, and events from the transcript — not generic fantasy filler.
- Write like a knowledgeable friend recapping the session: vivid and grounded, not grandiose.
- Avoid "LinkedIn-core" rhetoric: punchy antithesis ("Not a retreat, but a reckoning."), dramatic one-word sentences ("Courage."), and forced epiphanies ("That was the moment everything changed.").
- Vary sentence length. Short sentences land harder.

Use the following exerpts as models for tone and style:

EXAMPLE 1:
Welcome back. Last we left off, our group of adventurers had found their various individual fates come together here in the city of Trostenwald, where they had attended a carnival that had blown into town, had watched a horrible occurrence happen where one of the older attendees transformed into this terrifying zombie creature. Upon defeating it, you were all put under investigation as possible culprits for the reason that it occurred. In trying to wander the city to investigate and try and clear your name, you eventually found that there was a fiend hiding amongst these carnival workers. This large devil-like toad creature, which through some research you had found to actually be called a nergaliid, had killed two more of the guards, leaving you to fend with their transformed forms, and then fled deep into the center of the Ustaloch Lake.

EXAMPLE 2:
Last we left off, our slowly gathering band of adventurers had begun to have their stories intertwine in the city of Trostenwold, on the southern reaches of western Wynandir on the continent of Wildemount. Here we had Nott and Caleb who had been traveling southward coming and meeting, in the center of the tavern, the Nestled Nook Inn, with Jester, Beauregard, and Fjord. They were invited to a nearby carnival that had begun preparing for their performance later that evening, in which they met Yasha and Molly. After swapping some stories, earning and losing some gold, they began to gather at the outskirts of the Ustaloch, the lake right on the eastern edge of Trostenwold, for the first opening performance of the Fletching and Moondrop Carnival of Curiosities.

EXAMPLE 3:
And welcome back. So, last we left off, the Mighty Nein had gotten themselves involved in a number of various factions in the city of Zadash and decided to buy in to aid the Knights of Requital in their attempt to get one of the various powerful lords of the city and the High-Richter, both seemingly corrupt individuals, ousted. You had planned forgeries that you were going to place in their homes at night during an offsite gala in the Tri-Spires, not too far from where your breaking and entering was to occur. Bringing Ulog along, one of the members of the Knights of Requital, you snuck into Lord Sutan's house, managed to avoid a number of the pitfalls, traps, and contents within, going straight to the bedroom, where you battled the Rug of Smothering, knocking a couple of you out, but found within a couple of interesting items that you gathered, and the wax seal you needed to complete the forgeries to make this loop come together.`;

interface SegmentSpec {
  label: string;
  instruction: string;
}

function buildSegmentSpecs(moments: MomentCandidate[]): SegmentSpec[] {
  const specs: SegmentSpec[] = [
    {
      label: 'intro',
      instruction: 'INTRO — Set the scene for tonight\'s session. Briefly establish the party, where they are, and what they were doing as the session began. Do not narrate any of the highlight moments yet. (2-4 sentences)',
    },
  ];

  for (let i = 0; i < moments.length; i++) {
    const m = moments[i]!;
    const isFirst = i === 0;
    const transition = isFirst
      ? 'Begin with 1-2 sentences summarizing the events that led from the session start to this moment.'
      : 'Begin with 1-2 sentences condensing the events that happened between the previous moment and this one — what the party did, where they went, or what changed.';

    specs.push({
      label: `moment_${i + 1}`,
      instruction: `MOMENT ${i + 1} — [${m.category.toUpperCase()}] ${m.summary}. ${transition} Then narrate this moment specifically and vividly, referencing the actual characters and what they did. (3-5 sentences total)`,
    });
  }

  specs.push({
    label: 'outro',
    instruction: 'OUTRO — Close the recap with a brief reflection on how the session ended and tease what lies ahead. (2-3 sentences)',
  });

  return specs;
}

async function generateSegment(
  client: GoogleGenAI,
  spec: SegmentSpec,
  context: string,
  avatarParts: InputPart[],
  previousImage: Buffer | null,
): Promise<NarrativeSegment> {
  const styleRefParts: InputPart[] = previousImage
    ? [
        { text: 'Previous illustration — generate the next one in the exact same hand-drawn style, same character depictions, same color palette, and same artistic hand:' },
        { inlineData: { mimeType: 'image/png', data: previousImage.toString('base64') } },
      ]
    : [];

  const basePrompt = `${context}

Generate the following segment:
${spec.instruction}

Output exactly one paragraph of narration text followed by exactly one fantasy illustration (hand-drawn style, Dragonlance aesthetic, dramatic lighting). Do not generate multiple images. The character portraits above are for visual reference only — do not describe or list them in your narration.`;

  const contents: InputPart[] = [...avatarParts, ...styleRefParts, { text: basePrompt }];

  let lastText: string | null = null;
  let lastImage: Buffer | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[generate-narrative] ${spec.label} — attempt ${attempt}/${MAX_ATTEMPTS}`);

    const result = await client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    const parts = result.candidates?.[0]?.content?.parts ?? [];
    const types = parts.map((p) => ("text" in p ? "text" : "inlineData" in p ? "image" : "unknown")).join(", ");
    console.log(`[generate-narrative] ${spec.label} — ${parts.length} parts: ${types}`);

    let text: string | null = null;
    let image: Buffer | null = null;

    for (const part of parts) {
      if ("text" in part && part.text) {
        text = part.text.trim();
      } else if ("inlineData" in part && part.inlineData?.data) {
        image = Buffer.from(part.inlineData.data, "base64");
      }
    }

    if (text) lastText = text;
    if (image) lastImage = image;

    if (lastText && lastImage) {
      console.log(`[generate-narrative] ${spec.label} text preview: "${lastText.slice(0, 80)}..."`);
      return { label: spec.label, text: lastText, image: lastImage };
    }

    console.warn(`[generate-narrative] ${spec.label} — incomplete response (${types}), retrying...`);
  }

  // Accept partial output if we accumulated both text and image across separate attempts
  if (lastText && lastImage) {
    console.warn(`[generate-narrative] ${spec.label} — accepting combined output from separate attempts`);
    return { label: spec.label, text: lastText, image: lastImage };
  }

  throw new Error(`[generate-narrative] Failed to get text+image for ${spec.label} after ${MAX_ATTEMPTS} attempts`);
}

export async function generateNarrative(
  moments: MomentCandidate[],
  campaignContext: string,
  outputDir: string,
  characterAvatars: CharacterAvatar[] = [],
): Promise<Narrative> {
  requireConfig(["geminiApiKey"]);

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const selectedMoments = moments.filter((_, i) => i < 3);

  const context = `Campaign context:
${campaignContext}

Selected highlight moments (chronological order):
${selectedMoments.map((m, i) => `Moment ${i + 1}: [${m.category}] ${m.summary}\n  Excerpt: "${m.transcript_excerpt}"\n  Visual: ${m.visual_description}`).join("\n\n")}`;

  const avatarParts = await fetchAvatarParts(characterAvatars);
  const segmentSpecs = buildSegmentSpecs(selectedMoments);

  const segments: NarrativeSegment[] = [];
  let previousImage: Buffer | null = null;

  for (const spec of segmentSpecs) {
    const segment = await generateSegment(client, spec, context, avatarParts, previousImage);
    previousImage = segment.image;
    await writeFile(path.join(outputDir, `narrative_${spec.label}.png`), segment.image);
    console.log(`[generate-narrative] Saved narrative_${spec.label}.png (${segment.image.length} bytes)`);
    segments.push(segment);
  }

  // Persist text for --from-narrative resume
  const narrativeJson = Object.fromEntries(segments.map((s) => [s.label, s.text]));
  await writeFile(path.join(outputDir, "narrative.json"), JSON.stringify(narrativeJson, null, 2));
  console.log("[generate-narrative] Saved narrative.json");

  return segments;
}
