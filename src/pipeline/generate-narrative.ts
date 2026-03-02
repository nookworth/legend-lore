import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, requireConfig } from '../shared/config.js';
import type { MomentCandidate, Narrative, NarrativeSegment } from '../shared/types.js';

export async function generateNarrative(
  transcriptText: string,
  moments: MomentCandidate[],
  campaignContext: string,
  outputDir: string,
): Promise<Narrative> {
  requireConfig(['geminiApiKey']);

  const genai = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genai.getGenerativeModel({
    model: 'gemini-3.1-flash-image-preview',
    // @ts-expect-error -- responseModalities not yet in SDK types
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  const selectedMoments = moments.filter((_, i) => i < 3); // top 3

  const prompt = `You are a cinematic narrator for a D&D campaign in the Dragonlance setting. Write a session recap narrative with accompanying illustrations.

Campaign context:
${campaignContext}

Full session transcript:
${transcriptText}

Selected highlight moments (in order):
${selectedMoments.map((m, i) => `${i + 1}. [${m.category}] ${m.summary}\n   Excerpt: "${m.transcript_excerpt}"`).join('\n\n')}

Generate the following narrative segments, each paired with a fantasy illustration:
1. INTRO — Set the scene for tonight's session (2-4 sentences)
2. BRIDGE 1 — Transition between clip 1 and clip 2 (2-3 sentences)
3. BRIDGE 2 — Transition between clip 2 and clip 3 (2-3 sentences)
4. OUTRO — Closing reflection on the session (2-4 sentences)

For each segment, generate:
- The narration text (cinematic, dramatic tone appropriate for Dragonlance)
- A matching fantasy illustration (painterly style, Dragonlance aesthetic, dramatic lighting)

Output the segments in order: INTRO text, INTRO image, BRIDGE 1 text, BRIDGE 1 image, BRIDGE 2 text, BRIDGE 2 image, OUTRO text, OUTRO image.`;

  const MAX_ATTEMPTS = 3;
  let segments: NarrativeSegment[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[generate-narrative] Calling Gemini (attempt ${attempt}/${MAX_ATTEMPTS})...`);

    const result = await model.generateContent(prompt);
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];
    console.log(`[generate-narrative] Response: ${parts.length} parts, types: ${parts.map((p) => ('text' in p ? 'text' : 'inlineData' in p ? 'image' : 'unknown')).join(', ')}`);

    // Parse interleaved parts into segments
    // Pattern: text part → image part, repeating 4 times (intro, bridge1, bridge2, outro)
    segments = [];
    let pendingText: string | null = null;

    for (const part of parts) {
      if ('text' in part && part.text) {
        pendingText = part.text.trim();
      } else if ('inlineData' in part && part.inlineData) {
        const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
        segments.push({ text: pendingText ?? '', image: imageBuffer });
        pendingText = null;
      }
    }

    if (segments.length >= 4) break;
    console.log(`[generate-narrative] Got ${segments.length} segments, expected 4 — retrying...`);
  }

  if (segments.length < 4) {
    throw new Error(`Expected 4 narrative segments, got ${segments.length} after ${MAX_ATTEMPTS} attempts.`);
  }

  // Save images and text for inspection
  const labels = segments.map((_, i) =>
    i === 0 ? 'intro' : i === segments.length - 1 ? 'outro' : `bridge_${i}`,
  );
  for (let i = 0; i < segments.length; i++) {
    const label = labels[i]!;
    await writeFile(path.join(outputDir, `narrative_${label}.png`), segments[i]!.image);
    console.log(`[generate-narrative] Saved ${label} illustration (${segments[i]!.image.length} bytes)`);
    console.log(`[generate-narrative] ${label} text: "${segments[i]!.text.slice(0, 80)}..."`);
  }

  const narrativeJson = {
    intro: segments[0]!.text,
    bridges: segments.slice(1, -1).map((s) => s.text),
    outro: segments[segments.length - 1]!.text,
  };
  await writeFile(path.join(outputDir, 'narrative.json'), JSON.stringify(narrativeJson, null, 2));
  console.log('[generate-narrative] Saved narrative.json');

  return {
    intro: segments[0]!,
    bridges: segments.slice(1, -1),
    outro: segments[segments.length - 1]!,
  };
}
