import { GoogleGenAI } from "@google/genai";
import { readFile, writeFile } from "node:fs/promises";
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
      let mimeType: string;
      let data: string;
      if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
        const response = await fetch(avatarUrl);
        if (!response.ok) {
          console.warn(`[generate-narrative] Avatar fetch failed for ${name}: ${response.status}`);
          continue;
        }
        mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
        data = Buffer.from(await response.arrayBuffer()).toString('base64');
      } else {
        mimeType = 'image/png';
        data = (await readFile(avatarUrl)).toString('base64');
      }
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
console.log('[generate-narrative] Tone prompt type:', typeof TONE_PROMPT, TONE_PROMPT?.constructor?.name);
console.log('[generate-narrative] Tone prompt value:', String(TONE_PROMPT).slice(0, 300));
const SYSTEM_INSTRUCTION = `You are an omniscient narrator with the tongue of an epic poet, the pencil of a master illustrator, and an eye for facsimile to rival Vincent van Gogh. Your job is to recap a D&D session for the players who just finished it.

Narration style rules — follow these strictly:
- Stay in character as the narrator at all times. Never break the fourth wall. Your text must be narration only — no AI commentary, no descriptions of what you are generating, no acknowledgment of instructions.
- Plain prose only. No markdown, asterisks, bullet points, headers, or special characters.
- Be specific. Reference the actual character names, player decisions, and events from the transcript — not generic fantasy filler.
- Write like a knowledgeable friend recapping the session: vivid and grounded, not grandiose.
- Avoid "LinkedIn-core" rhetoric: punchy antithesis ("Not a retreat, but a reckoning."), dramatic one-word sentences ("Courage."), and forced epiphanies ("That was the moment everything changed.").
- Vary sentence length. Short sentences land harder.
- Use third person throughout — he, she, they, their. Never address the party or any character as "you" or "your". This must be consistent across every segment.
- Do not reference portraits, reference images, or the fact that character images were provided. Write as if you simply know what the characters look like.
- If you quote a player or character directly, you must attribute the quote to the correct speaker using the Attributions provided for that moment. Never attribute a quote to the wrong person.

${TONE_PROMPT}`;

interface SegmentSpec {
  label: string;
  instruction: string;
}

function buildSegmentSpecs(
  moments: MomentCandidate[],
  bookends?: { sessionStart?: string; sessionEnd?: string },
): SegmentSpec[] {
  const introInstruction = bookends?.sessionStart
    ? `INTRO — Set the scene for tonight's session. Here is how the session opened:\n\n${bookends.sessionStart}\n\nUse this to establish where the party was and what they were doing at the start of the session. Do not narrate any of the highlight moments yet. (2-4 sentences)`
    : "INTRO — Set the scene for tonight's session. Briefly establish the party, where they are, and what they were doing as the session began. Do not narrate any of the highlight moments yet. (2-4 sentences)";

  const outroInstruction = bookends?.sessionEnd
    ? `OUTRO — Close the recap with a brief reflection on how the session ended and tease what lies ahead. Here is how the session closed:\n\n${bookends.sessionEnd}\n\nUse this to ground the outro in what actually happened at the end of the session. (2-3 sentences)`
    : "OUTRO — Close the recap with a brief reflection on how the session ended and tease what lies ahead. (2-3 sentences)";

  const specs: SegmentSpec[] = [
    {
      label: "intro",
      instruction: introInstruction,
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
    instruction: outroInstruction,
  });

  return specs;
}

function buildCombinedPrompt(specs: SegmentSpec[], context: string): string {
  const segmentList = specs
    .map(
      (s, i) =>
        `SEGMENT ${i + 1} — ${s.label.toUpperCase()}\n${s.instruction}`,
    )
    .join("\n\n");

  return `${context}

Generate all ${specs.length} narrative segments in order:

${segmentList}

For each segment output exactly one paragraph of narration text immediately followed by exactly one fantasy illustration (hand-drawn style, Dragonlance aesthetic, dramatic lighting, wide landscape 16:9 format). No labels, headers, or commentary between segments. Use the character portraits above, supplemented by the biographical details in the campaign context, as reference material.
Text may be part of the image if it is a legitimate part of the scene, e.g. a map with writing on it. Let the image and the narration do the talking; there is no need for text overlays.`;
}

async function generateNarrativeSinglePrompt(
  client: GoogleGenAI,
  specs: SegmentSpec[],
  context: string,
  avatarParts: InputPart[],
): Promise<NarrativeSegment[] | null> {
  const prompt = buildCombinedPrompt(specs, context);
  const contents: InputPart[] = [...avatarParts, { text: prompt }];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(
      `[generate-narrative] Single-prompt — attempt ${attempt}/${MAX_ATTEMPTS}`,
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

    const usage = result.usageMetadata;
    if (usage) {
      console.log(
        `[generate-narrative] Single-prompt — tokens: prompt=${usage.promptTokenCount}, candidates=${usage.candidatesTokenCount}, total=${usage.totalTokenCount}`,
      );
    }

    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const parts = candidate?.content?.parts ?? [];
    const types = parts
      .map((p) =>
        "text" in p ? "text" : "inlineData" in p ? "image" : "unknown",
      )
      .join(", ");
    console.log(
      `[generate-narrative] Single-prompt — ${parts.length} parts: ${types}${finishReason ? ` (finishReason: ${finishReason})` : ""}`,
    );

    const pairs: Array<{ text: string; image: Buffer }> = [];
    const textBuffer: string[] = [];

    for (const part of parts) {
      if ("text" in part && part.text?.trim()) {
        textBuffer.push(part.text.trim());
      } else if ("inlineData" in part && part.inlineData?.data) {
        if (textBuffer.length) {
          pairs.push({
            text: textBuffer.join(" "),
            image: Buffer.from(part.inlineData.data, "base64"),
          });
          textBuffer.length = 0;
        }
      }
    }

    if (pairs.length === specs.length) {
      console.log(
        `[generate-narrative] Single-prompt: got ${pairs.length}/${specs.length} pairs`,
      );
      return specs.map((spec, i) => ({
        label: spec.label,
        text: pairs[i]!.text,
        image: pairs[i]!.image,
      }));
    }

    console.warn(
      `[generate-narrative] Single-prompt — got ${pairs.length}/${specs.length} pairs, retrying...`,
    );
  }

  return null;
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

    const usage = result.usageMetadata;
    if (usage) {
      console.log(
        `[generate-narrative] ${spec.label} — tokens: prompt=${usage.promptTokenCount}, candidates=${usage.candidatesTokenCount}, total=${usage.totalTokenCount}`,
      );
    }

    const candidate = result.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const parts = candidate?.content?.parts ?? [];
    const types = parts
      .map((p) =>
        "text" in p ? "text" : "inlineData" in p ? "image" : "unknown",
      )
      .join(", ");
    console.log(
      `[generate-narrative] ${spec.label} — ${parts.length} parts: ${types}${finishReason ? ` (finishReason: ${finishReason})` : ""}`,
    );

    let text: string | null = null;
    let image: Buffer | null = null;

    for (const part of parts) {
      // Take the first text part only — later parts are often model meta-commentary
      if ("text" in part && part.text && !text) {
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

  // If we have an image but no text, try a text-only fallback call
  if (lastImage && !lastText) {
    console.warn(
      `[generate-narrative] ${spec.label} — image-only after ${MAX_ATTEMPTS} attempts, trying text-only fallback...`,
    );
    const fallback = await client.models.generateContent({
      model: MODEL,
      contents: [...avatarParts, { text: `${context}\n\nGenerate the following segment:\n${spec.instruction}\n\nOutput only the narration text paragraph. Do not generate an image.` }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseModalities: ["TEXT"],
      },
    });
    for (const part of fallback.candidates?.[0]?.content?.parts ?? []) {
      if ("text" in part && part.text) {
        lastText = part.text.trim();
        break;
      }
    }
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
  sessionBookends?: { sessionStart?: string; sessionEnd?: string },
  narrativeMode: 'single' | 'multi' = 'single',
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
${selectedMoments.map((m, i) => {
    const attributionLines = m.attributions?.length
      ? `\n  Attributions:\n${m.attributions.map((a) => `    - ${a.speaker}: "${a.quote}"`).join('\n')}`
      : '';
    return `Moment ${i + 1}: [${m.category}] ${m.summary}\n  Preceded by: ${m.preceding_events}\n  Excerpt: "${m.transcript_excerpt}"${attributionLines}\n  Visual: ${m.visual_description}`;
  }).join("\n\n")}`;

  const avatarParts = await fetchAvatarParts(characterAvatars);
  const segmentSpecs = buildSegmentSpecs(selectedMoments, sessionBookends);

  let segments = narrativeMode === 'single'
    ? await generateNarrativeSinglePrompt(client, segmentSpecs, context, avatarParts)
    : null;
  if (!segments) {
    if (narrativeMode === 'single') {
      console.warn('[generate-narrative] Single-prompt failed, falling back to per-segment calls');
    } else {
      console.log('[generate-narrative] Using per-segment calls (--narrative-mode=multi)');
    }
    segments = [];
    for (const spec of segmentSpecs) {
      segments.push(await generateSegment(client, spec, context, avatarParts));
    }
  }

  for (const segment of segments) {
    await writeFile(
      path.join(outputDir, `narrative_${segment.label}.png`),
      segment.image,
    );
    console.log(
      `[generate-narrative] Saved narrative_${segment.label}.png (${segment.image.length} bytes)`,
    );
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
