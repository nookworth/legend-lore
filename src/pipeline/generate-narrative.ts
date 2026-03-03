import { GoogleGenAI } from "@google/genai";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config, requireConfig } from "../shared/config.js";
import type {
  MomentCandidate,
  Narrative,
  NarrativeSegment,
} from "../shared/types.js";

export async function generateNarrative(
  transcriptText: string,
  moments: MomentCandidate[],
  campaignContext: string,
  outputDir: string,
): Promise<Narrative> {
  requireConfig(["geminiApiKey"]);

  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const selectedMoments = moments.filter((_, i) => i < 3); // top 3

  const prompt = `You are a narrator recapping a D&D session for the players who just finished it. Write a session recap narrative with accompanying illustrations.

Campaign context:
${campaignContext}

Full session transcript:
${transcriptText}

Selected highlight moments (in order):
${selectedMoments.map((m, i) => `${i + 1}. [${m.category}] ${m.summary}\n   Excerpt: "${m.transcript_excerpt}"`).join("\n\n")}

Generate the following narrative segments, each paired with a fantasy illustration:
1. INTRO — Set the scene for tonight's session (2-4 sentences)
2. BRIDGE 1 — Transition between clip 1 and clip 2 (2-3 sentences)
3. BRIDGE 2 — Transition between clip 2 and clip 3 (2-3 sentences)
4. OUTRO — Closing reflection on the session (2-4 sentences)

Narration style rules — follow these strictly:
- Plain prose only. No markdown, asterisks, bullet points, headers, or special characters.
- Be specific. Reference the actual character names, player decisions, and events from the transcript — not generic fantasy filler.
- Write like a knowledgeable friend recapping the session: vivid and grounded, not grandiose.
- Avoid "LinkedIn-core" rhetoric: punchy antithesis ("Not a retreat, but a reckoning."), dramatic one-word sentences ("Courage."), and forced epiphanies ("That was the moment everything changed.").
- Vary sentence length. Short sentences land harder.

Use the following excerpts as models for tone and style. Do not include proper nouns from these excerpts in your narratives; they are specific to a different campaign. They are included here only as examples of style and tone.

EXAMPLE 1:
Welcome back. Last we left off, our group of adventurers had found their various individual fates come together here in the city of Trostenwald, where they had attended a carnival that had blown into town, had watched a horrible occurrence happen where one of the older attendees transformed into this terrifying zombie creature. Upon defeating it, you were all put under investigation as possible culprits for the reason that it occurred. In trying to wander the city to investigate and try and clear your name, you eventually found that there was a fiend hiding amongst these carnival workers. This large devil-like toad creature, which through some research you had found to actually be called a nergaliid, had killed two more of the guards, leaving you to fend with their transformed forms, and then fled deep into the center of the Ustaloch Lake.

EXAMPLE 2:
Last we left off, our slowly gathering band of adventurers had begun to have their stories intertwine in the city of Trostenwold, on the southern reaches of western Wynandir on the continent of Wildemount. Here we had Nott and Caleb who had been traveling southward coming and meeting, in the center of the tavern, the Nestled Nook Inn, with Jester, Beauregard, and Fjord. They were invited to a nearby carnival that had begun preparing for their performance later that evening, in which they met Yasha and Molly. After swapping some stories, earning and losing some gold, they began to gather at the outskirts of the Ustaloch, the lake right on the eastern edge of Trostenwold, for the first opening performance of the Fletching and Moondrop Carnival of Curiosities.

EXAMPLE 3:
And welcome back. So, last we left off, the Mighty Nein had gotten themselves involved in a number of various factions in the city of Zadash and decided to buy in to aid the Knights of Requital in their attempt to get one of the various powerful lords of the city and the High-Richter, both seemingly corrupt individuals, ousted. You had planned forgeries that you were going to place in their homes at night during an offsite gala in the Tri-Spires, not too far from where your breaking and entering was to occur. Bringing Ulog along, one of the members of the Knights of Requital, you snuck into Lord Sutan's house, managed to avoid a number of the pitfalls, traps, and contents within, going straight to the bedroom, where you battled the Rug of Smothering, knocking a couple of you out, but found within a couple of interesting items that you gathered, and the wax seal you needed to complete the forgeries to make this loop come together.


For each segment, generate:
- The narration text (following the style rules above)
- A matching fantasy illustration (painterly style, Dragonlance aesthetic, dramatic lighting)

Output the segments in order: INTRO text, INTRO image, BRIDGE 1 text, BRIDGE 1 image, BRIDGE 2 text, BRIDGE 2 image, OUTRO text, OUTRO image.`;

  const MAX_ATTEMPTS = 3;
  let segments: NarrativeSegment[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(
      `[generate-narrative] Calling Gemini (attempt ${attempt}/${MAX_ATTEMPTS})...`,
    );

    const result = await client.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: prompt,
      config: { responseModalities: ["TEXT", "IMAGE"] },
    });
    const parts = result.candidates?.[0]?.content?.parts ?? [];
    console.log(
      `[generate-narrative] Response: ${parts.length} parts, types: ${parts.map((p) => ("text" in p ? "text" : "inlineData" in p ? "image" : "unknown")).join(", ")}`,
    );

    // Parse interleaved parts into segments
    // Pattern: text part → image part, repeating 4 times (intro, bridge1, bridge2, outro)
    segments = [];
    let pendingText: string | null = null;

    for (const part of parts) {
      if ("text" in part && part.text) {
        pendingText = part.text.trim();
      } else if ("inlineData" in part && part.inlineData?.data) {
        const imageBuffer = Buffer.from(part.inlineData.data, "base64");
        segments.push({ text: pendingText ?? "", image: imageBuffer });
        pendingText = null;
      }
    }

    if (segments.length >= 4) break;
    console.log(
      `[generate-narrative] Got ${segments.length} segments, expected 4 — retrying...`,
    );
  }

  if (segments.length < 4) {
    throw new Error(
      `Expected 4 narrative segments, got ${segments.length} after ${MAX_ATTEMPTS} attempts.`,
    );
  }

  // Save images and text for inspection
  const labels = segments.map((_, i) =>
    i === 0 ? "intro" : i === segments.length - 1 ? "outro" : `bridge_${i}`,
  );
  for (let i = 0; i < segments.length; i++) {
    const label = labels[i]!;
    await writeFile(
      path.join(outputDir, `narrative_${label}.png`),
      segments[i]!.image,
    );
    console.log(
      `[generate-narrative] Saved ${label} illustration (${segments[i]!.image.length} bytes)`,
    );
    console.log(
      `[generate-narrative] ${label} text: "${segments[i]!.text.slice(0, 80)}..."`,
    );
  }

  const narrativeJson = {
    intro: segments[0]!.text,
    bridges: segments.slice(1, -1).map((s) => s.text),
    outro: segments[segments.length - 1]!.text,
  };
  await writeFile(
    path.join(outputDir, "narrative.json"),
    JSON.stringify(narrativeJson, null, 2),
  );
  console.log("[generate-narrative] Saved narrative.json");

  return {
    intro: segments[0]!,
    bridges: segments.slice(1, -1),
    outro: segments[segments.length - 1]!,
  };
}
