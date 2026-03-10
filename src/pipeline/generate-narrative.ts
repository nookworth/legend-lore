import { GoogleGenAI } from "@google/genai";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config, requireConfig } from "../shared/config.js";
import type {
  MomentCandidate,
  Narrative,
  NarrativeSegment,
} from "../shared/types.js";
import * as hub from 'langchain/hub/node'
import * as wrappers from 'langsmith/wrappers'

const MODEL = "gemini-3.1-flash-image-preview";
const MAX_ATTEMPTS = 3;

export interface CharacterAvatar {
  name: string;
  avatarUrl: string;
}

type InputPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

async function fetchAvatarParts(
  avatars: CharacterAvatar[],
): Promise<InputPart[]> {
  if (avatars.length === 0) return [];
  const parts: InputPart[] = [
    {
      text: "Character reference portraits — use these to accurately depict the characters in all illustrations:",
    },
  ];
  for (const { name, avatarUrl } of avatars) {
    try {
      const response = await fetch(avatarUrl);
      if (!response.ok) {
        console.warn(
          `[generate-narrative] Avatar fetch failed for ${name}: ${response.status}`,
        );
        continue;
      }
      const mimeType =
        response.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      const data = Buffer.from(await response.arrayBuffer()).toString("base64");
      parts.push({ text: `${name}:` }, { inlineData: { mimeType, data } });
      console.log(`[generate-narrative] Loaded avatar for ${name}`);
    } catch (err) {
      console.warn(
        `[generate-narrative] Could not fetch avatar for ${name}: ${err}`,
      );
    }
  }
  return parts;
}
const TONE_PROMPT = await hub.pull("tone_prompt:87b8f49a");
const SYSTEM_INSTRUCTION = `You are an omniscient narrator with the tongue of an epic poet, the pencil of a master illustrator, and an eye for facsimile to rival Vincent van Gogh. Your job is to recap a D&D session for the players who just finished it.

Narration style rules — follow these strictly:
- Stay in character as the narrator at all times. Never break the fourth wall. Never describe, explain, or comment on what you are generating. Never acknowledge instructions or speak as an AI. Output only the narration itself.
- Plain prose only. No markdown, asterisks, bullet points, headers, or special characters.
- Be specific. Reference the actual character names, player decisions, and events from the transcript — not generic fantasy filler.
- Write like a knowledgeable friend recapping the session: vivid and grounded, not grandiose.
- Avoid "LinkedIn-core" rhetoric: punchy antithesis ("Not a retreat, but a reckoning."), dramatic one-word sentences ("Courage."), and forced epiphanies ("That was the moment everything changed.").
- Vary sentence length. Short sentences land harder.

${TONE_PROMPT}`;

interface SegmentSpec {
  label: string;
  instruction: string;
}

function buildSegmentSpecs(moments: MomentCandidate[]): SegmentSpec[] {
  const specs: SegmentSpec[] = [
    {
      label: "intro",
      instruction:
        "INTRO — Set the scene for tonight's session. Briefly establish the party, where they are, and what they were doing as the session began. Do not narrate any of the highlight moments yet. (2-4 sentences)",
    },
  ];

  for (let i = 0; i < moments.length; i++) {
    const m = moments[i]!;
    const isFirst = i === 0;
    const transition = isFirst
      ? "Begin with 1-2 sentences summarizing the events that led from the session start to this moment."
      : "Begin with 1-2 sentences condensing the events that happened between the previous moment and this one — what the party did, where they went, or what changed.";

    specs.push({
      label: `moment_${i + 1}`,
      instruction: `MOMENT ${i + 1} — [${m.category.toUpperCase()}] ${m.summary}. ${transition} Then narrate this moment specifically and vividly, referencing the actual characters and what they did. (3-5 sentences total)`,
    });
  }

  specs.push({
    label: "outro",
    instruction:
      "OUTRO — Close the recap with a brief reflection on how the session ended and tease what lies ahead. (2-3 sentences)",
  });

  return specs;
}

async function generateSegment(
  client: GoogleGenAI,
  spec: SegmentSpec,
  context: string,
  avatarParts: InputPart[],
): Promise<NarrativeSegment> {
  const basePrompt = `${context}

Generate the following segment:
${spec.instruction}

Output exactly one paragraph of narration text followed by exactly one fantasy illustration (hand-drawn style, Dragonlance aesthetic, dramatic lighting, wide landscape 16:9 format). Do not generate multiple images. Use the character portraits above, supplemented by the biographical details in the campaign context, as reference material.
Text may be part of the image if it is a legitimate part of the scene, e.g. a map with writing on it. Let the image and the narration do the talking; there is no need for text overlays.
`;

  const contents: InputPart[] = [...avatarParts, { text: basePrompt }];

  let lastText: string | null = null;
  let lastImage: Buffer | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(
      `[generate-narrative] ${spec.label} — attempt ${attempt}/${MAX_ATTEMPTS}`,
    );

    const result = await client.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });

    const parts = result.candidates?.[0]?.content?.parts ?? [];
    const types = parts
      .map((p) =>
        "text" in p ? "text" : "inlineData" in p ? "image" : "unknown",
      )
      .join(", ");
    console.log(
      `[generate-narrative] ${spec.label} — ${parts.length} parts: ${types}`,
    );

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
      console.log(
        `[generate-narrative] ${spec.label} text preview: "${lastText.slice(0, 80)}..."`,
      );
      return { label: spec.label, text: lastText, image: lastImage };
    }

    console.warn(
      `[generate-narrative] ${spec.label} — incomplete response (${types}), retrying...`,
    );
  }

  // Accept partial output if we accumulated both text and image across separate attempts
  if (lastText && lastImage) {
    console.warn(
      `[generate-narrative] ${spec.label} — accepting combined output from separate attempts`,
    );
    return { label: spec.label, text: lastText, image: lastImage };
  }

  throw new Error(
    `[generate-narrative] Failed to get text+image for ${spec.label} after ${MAX_ATTEMPTS} attempts`,
  );
}

export async function generateNarrative(
  moments: MomentCandidate[],
  campaignContext: string,
  outputDir: string,
  characterAvatars: CharacterAvatar[] = [],
): Promise<Narrative> {
  requireConfig(["geminiApiKey"]);

  const geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const client = wrappers.wrapSDK(geminiClient, {
    // @ts-expect-error
    tracing_extra: {
      tags: ['gemini', 'typescript'],
      metadata: {
        integration: 'google-genai'
      },
    },
  })

  const selectedMoments = moments.filter((_, i) => i < 3);

  const context = `Campaign context:
${campaignContext}

Selected highlight moments (chronological order):
${selectedMoments.map((m, i) => `Moment ${i + 1}: [${m.category}] ${m.summary}\n  Excerpt: "${m.transcript_excerpt}"\n  Visual: ${m.visual_description}`).join("\n\n")}`;

  const avatarParts = await fetchAvatarParts(characterAvatars);
  const segmentSpecs = buildSegmentSpecs(selectedMoments);

  const segments: NarrativeSegment[] = [];
  for (const spec of segmentSpecs) {
    const segment = await generateSegment(client, spec, context, avatarParts);
    await writeFile(
      path.join(outputDir, `narrative_${spec.label}.png`),
      segment.image,
    );
    console.log(
      `[generate-narrative] Saved narrative_${spec.label}.png (${segment.image.length} bytes)`,
    );
    segments.push(segment);
  }

  // Persist text for --from-narrative resume
  const narrativeJson = Object.fromEntries(
    segments.map((s) => [s.label, s.text]),
  );
  await writeFile(
    path.join(outputDir, "narrative.json"),
    JSON.stringify(narrativeJson, null, 2),
  );
  console.log("[generate-narrative] Saved narrative.json");

  return segments;
}
