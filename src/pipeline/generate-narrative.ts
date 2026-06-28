import { GoogleGenAI } from "@google/genai";
import { readFile, writeFile } from "node:fs/promises";
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

Use the following excerpts as models for tone and style:

EXAMPLE 1:
Upon arriving they found the town in a very dark emotional place: zombie giants roving the streets as controlled centurions, a number of the individuals in the town feeling unrest. So they decided to build a revolt. Percy helming the de Rolo crest, Vox Machina went around inciting the thoughts of rebellion within the city—not the first, but apparently the one with the most chance of succeeding they've had to this date. After some infiltrations and sizeable victories, cutting down some of the underlings of the Briarwoods within the city, the people began to arm themselves, rise up—fire, blade, and screaming took the city as the denizens began to fight back. In this chaos, Vox Machina made their way underneath the castle Whitestone, where the Lord and Lady Briarwood currently reside, seeking some sort of project called a Ziggurat.

EXAMPLE 2:
In Halandil Fang's home, Thaisha Lloy has remembered the silver box she brought with her that Thjazi told her to retrieve from Venatus to give to Bolaire Lathalia, and taken Hal with her upstairs to get it. However, when Thimble's name was mentioned downstairs, the box flew open and shattered black ceramic began moving together into the shape of a mask. Thaisha nudges one of the fragments and a roiling mist swallows both the fragments and Thaisha, sending her unconscious to the ground. Hal immediately casts Healing Word on her. Vaelus, Bolaire, and Murray Mag'Nesson rush in along with Shadia. When Bolaire inspects the box, the fragments are gone and the box holds only a thick fog. He notes that it bears writing in a halfling language interspersed with Celestial glyphs, including a word for the Tenebral Reaches, and realizes the box is a coffin for a halfling.

EXAMPLE 3:
The party, having found their way back to the city of Westruun, which had been overrun by the herd of roving nomadic tribal barbarians and other such brigands that wander the landscape of Tal'Dorei—that Grog once belonged to—had swooped in and taken Westruun after the Chroma Conclave dragon attack across this countryside. The party have devised a plan to find their way into the town—or at least one of them would—distract a cluster of these individuals, these goliaths, pulling them out of the city into a large pit that had been hidden after being carved by the druid Keyleth.
`;

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

- For each segment output exactly one paragraph of narration text immediately followed by exactly one fantasy illustration (hand-drawn style, Dragonlance aesthetic, dramatic lighting, wide landscape 16:9 format).
- No labels, headers, or commentary between segments. Use the character portraits above, supplemented by the biographical details in the campaign context, as reference material to depict the player characters as accurately and consistently as possible across segments.
- Text may be part of the image if it makes sense in-universe, e.g. a map with writing on it. Let the image and the narration do the talking; there is no need for text overlays.
- Whenever two or more segments share the same location, give each one a distinct shot: vary the camera angle, the distance (wide establishing / medium / close-up), and the composition, so that no two illustrations of that place look alike — even when the segments are not back-to-back.
`;
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

    if (finishReason === 'MAX_TOKENS') {
      console.warn(
        `[generate-narrative] Single-prompt — hit output token limit after ${pairs.length}/${specs.length} pairs, falling back immediately`,
      );
      return null;
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

- Output exactly one paragraph of narration text followed by exactly one fantasy illustration (hand-drawn style, Dragonlance aesthetic, dramatic lighting, wide landscape 16:9 format). Do not generate multiple images. Use the character portraits above, supplemented by the biographical details in the campaign context, as reference material to depict the player characters as accurately as possible.
- Text may be part of the image if makes sense in-universe, e.g. a map with writing on it. Let the image and the narration do the talking; there is no need for text overlays.
- Never show the same party member twice in a single illustration. The only exception is an in-game effect that deliberately duplicates a character (e.g. Mirror Image), where multiple copies are the point.
- In calm "at rest" scenes — the party gathered at camp, traveling together, or deliberating — depict every party member featured in this session (the characters shown in the reference portraits), even those not individually named in this segment.
- In action, combat, or single-character focus scenes, depict only the characters the segment actually features. The spotlight may fall on a few; the rest can be absent.
- Do not invent named characters. Depict only the party members and any specific individuals named in this segment. Unnamed background figures - crowds, throngs, gatherings of NPCs — are fine wherever the scene calls for them.
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
  extraInstructions?: string,
): Promise<Narrative> {
  requireConfig(["geminiApiKey"]);

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const selectedMoments = moments.filter((_, i) => i < 3);

  const extraSection = extraInstructions?.trim()
    ? `\n\nADDITIONAL INSTRUCTIONS FOR THIS RUN (operator-provided — prioritize these over the general guidance where they conflict):\n${extraInstructions.trim()}`
    : '';

  const context = `Campaign context:
${campaignContext}

Selected highlight moments (chronological order):
${selectedMoments.map((m, i) => {
    const attributionLines = m.attributions?.length
      ? `\n  Attributions:\n${m.attributions.map((a) => `    - ${a.speaker}: "${a.quote}"`).join('\n')}`
      : '';
    return `Moment ${i + 1}: [${m.category}] ${m.summary}\n  Preceded by: ${m.preceding_events}\n  Excerpt: "${m.transcript_excerpt}"${attributionLines}\n  Visual: ${m.visual_description}`;
  }).join("\n\n")}${extraSection}`;

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
