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
const MAX_ATTEMPTS = 3

// Static system instruction — narrator persona, style rules, and CR examples.
// Separated from per-call content so it isn't reconstructed on every segment call.
const SYSTEM_INSTRUCTION = `You are a narrator recapping a D&D session for the players who just finished it.

Narration style rules — follow these strictly:
- Plain prose only. No markdown, asterisks, bullet points, headers, or special characters.
- Be specific. Reference the actual character names, player decisions, and events from the transcript — not generic fantasy filler.
- Write like a knowledgeable friend recapping the session: vivid and grounded, not grandiose.
- Avoid "LinkedIn-core" rhetoric: punchy antithesis ("Not a retreat, but a reckoning."), dramatic one-word sentences ("Courage."), and forced epiphanies ("That was the moment everything changed.").
- Vary sentence length. Short sentences land harder.

The following excerpts are models for tone and style only. Do not use proper nouns from them — they are from a different campaign.

EXAMPLE 1:
Welcome back. Last we left off, our group of adventurers had found their various individual fates come together here in the city of Trostenwald, where they had attended a carnival that had blown into town, had watched a horrible occurrence happen where one of the older attendees transformed into this terrifying zombie creature. Upon defeating it, you were all put under investigation as possible culprits for the reason that it occurred. In trying to wander the city to investigate and try and clear your name, you eventually found that there was a fiend hiding amongst these carnival workers. This large devil-like toad creature, which through some research you had found to actually be called a nergaliid, had killed two more of the guards, leaving you to fend with their transformed forms, and then fled deep into the center of the Ustaloch Lake.

EXAMPLE 2:
Last we left off, our slowly gathering band of adventurers had begun to have their stories intertwine in the city of Trostenwold, on the southern reaches of western Wynandir on the continent of Wildemount. Here we had Nott and Caleb who had been traveling southward coming and meeting, in the center of the tavern, the Nestled Nook Inn, with Jester, Beauregard, and Fjord. They were invited to a nearby carnival that had begun preparing for their performance later that evening, in which they met Yasha and Molly. After swapping some stories, earning and losing some gold, they began to gather at the outskirts of the Ustaloch, the lake right on the eastern edge of Trostenwold, for the first opening performance of the Fletching and Moondrop Carnival of Curiosities.

EXAMPLE 3:
And welcome back. So, last we left off, the Mighty Nein had gotten themselves involved in a number of various factions in the city of Zadash and decided to buy in to aid the Knights of Requital in their attempt to get one of the various powerful lords of the city and the High-Richter, both seemingly corrupt individuals, ousted. You had planned forgeries that you were going to place in their homes at night during an offsite gala in the Tri-Spires, not too far from where your breaking and entering was to occur. Bringing Ulog along, one of the members of the Knights of Requital, you snuck into Lord Sutan's house, managed to avoid a number of the pitfalls, traps, and contents within, going straight to the bedroom, where you battled the Rug of Smothering, knocking a couple of you out, but found within a couple of interesting items that you gathered, and the wax seal you needed to complete the forgeries to make this loop come together.`;

const SEGMENT_SPECS = [
  { label: 'intro',    instruction: 'INTRO — Set the scene for tonight\'s session (2-4 sentences)' },
  { label: 'bridge_1', instruction: 'BRIDGE 1 — Transition between clip 1 and clip 2 (2-3 sentences)' },
  { label: 'bridge_2', instruction: 'BRIDGE 2 — Transition between clip 2 and clip 3 (2-3 sentences)' },
  { label: 'outro',    instruction: 'OUTRO — Closing reflection on the session (2-4 sentences)' },
] as const;

async function generateSegment(
  client: GoogleGenAI,
  spec: (typeof SEGMENT_SPECS)[number],
  context: string,
): Promise<NarrativeSegment> {
  const prompt = `${context}

Generate the ${spec.instruction}.

Output the narration text followed immediately by a matching fantasy illustration (painterly style, Dragonlance aesthetic, dramatic lighting).`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[generate-narrative] ${spec.label} — attempt ${attempt}/${MAX_ATTEMPTS}`);

    const result = await client.models.generateContent({
      model: MODEL,
      contents: prompt,
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
        if (!image) console.log(`[generate-narrative] ${spec.label} text preview: "${text.slice(0, 80)}..."`);
      } else if ("inlineData" in part && part.inlineData?.data) {
        image = Buffer.from(part.inlineData.data, "base64");
      }
    }

    if (text && image) return { text, image };

    if (!image) {
      console.warn(`[generate-narrative] ${spec.label} — no image returned. Text was: "${text?.slice(0, 120) ?? '(none)'}"`);
    }
  }

  throw new Error(`[generate-narrative] Failed to get text+image for ${spec.label} after ${MAX_ATTEMPTS} attempts`);
}

export async function generateNarrative(
  moments: MomentCandidate[],
  campaignContext: string,
  outputDir: string,
): Promise<Narrative> {
  requireConfig(["geminiApiKey"]);

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const selectedMoments = moments.filter((_, i) => i < 3);

  // Per-call context: campaign info and moments only.
  // The full transcript is not needed here — moments already contain summaries and excerpts.
  const context = `Campaign context:
${campaignContext}

Selected highlight moments (in order):
${selectedMoments.map((m, i) => `${i + 1}. [${m.category}] ${m.summary}\n   Excerpt: "${m.transcript_excerpt}"\n   Visual: ${m.visual_description}`).join("\n\n")}`;

  const segments: NarrativeSegment[] = [];
  for (const spec of SEGMENT_SPECS) {
    const segment = await generateSegment(client, spec, context);
    await writeFile(path.join(outputDir, `narrative_${spec.label}.png`), segment.image);
    console.log(`[generate-narrative] Saved narrative_${spec.label}.png (${segment.image.length} bytes)`);
    segments.push(segment);
  }

  const narrativeJson = {
    intro: segments[0]!.text,
    bridges: [segments[1]!.text, segments[2]!.text],
    outro: segments[3]!.text,
  };
  await writeFile(path.join(outputDir, "narrative.json"), JSON.stringify(narrativeJson, null, 2));
  console.log("[generate-narrative] Saved narrative.json");

  return {
    intro: segments[0]!,
    bridges: [segments[1]!, segments[2]!],
    outro: segments[3]!,
  };
}
