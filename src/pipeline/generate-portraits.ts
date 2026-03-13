import { GoogleGenAI } from '@google/genai';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config, requireConfig } from '../shared/config.js';
import { uploadPortrait, downloadPortrait } from '../shared/storage.js';
import type { CharacterAvatar } from './generate-narrative.js';

const MODEL = 'gemini-3.1-flash-image-preview';
const PORTRAITS_CACHE_DIR = path.join('data', 'portraits');

const ALIGNMENT_MAP: Record<number, string> = {
  1: 'Lawful Good',
  2: 'Neutral Good',
  3: 'Chaotic Good',
  4: 'Lawful Neutral',
  5: 'True Neutral',
  6: 'Chaotic Neutral',
  7: 'Lawful Evil',
  8: 'Neutral Evil',
  9: 'Chaotic Evil',
};

export { ALIGNMENT_MAP };

export interface CharacterForPortrait {
  name: string;
  avatarUrl: string;
  race: string;
  classes: string; // pre-formatted, e.g. "Cleric (Twilight Domain)"
  alignment?: string | null | undefined;
  gender?: string | null | undefined;
  age?: string | null | undefined;
  height?: string | null | undefined;
  weight?: string | null | undefined;
  hair?: string | null | undefined;
  eyes?: string | null | undefined;
  skin?: string | null | undefined;
  equipment: string[];
}

function nameSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function buildPortraitPrompt(c: CharacterForPortrait): string {
  const physical = [
    c.gender,
    c.age ? `age ${c.age}` : null,
    c.height,
    c.weight,
    c.hair ? `${c.hair} hair` : null,
    c.eyes ? `${c.eyes} eyes` : null,
    c.skin ? `${c.skin} skin` : null,
  ].filter(Boolean).join(', ');

  const lines = [
    `Here is ${c.name}'s avatar. Using it as a strict visual reference for their face, coloring, and distinctive features, draw a hand-drawn character portrait in Dragonlance aesthetic (full body or waist-up, dramatic lighting).`,
    '',
    'Character details to incorporate:',
    `- Race / Class: ${c.race} ${c.classes}`,
  ];
  if (c.alignment) lines.push(`- Alignment: ${c.alignment}`);
  if (physical) lines.push(`- Physical: ${physical}`);
  if (c.equipment.length) lines.push(`- Equipment: ${c.equipment.join(', ')}`);
  lines.push('', 'Render them equipped for adventure. Maintain strict likeness to the reference avatar. Do not add text overlays or labels.');

  return lines.join('\n');
}

async function generatePortrait(
  client: GoogleGenAI,
  character: CharacterForPortrait,
  outputDir: string,
  regenPortraits: boolean,
): Promise<CharacterAvatar> {
  const slug = nameSlug(character.name);
  const cachePath = path.join(PORTRAITS_CACHE_DIR, `portrait_${slug}.png`);
  const outputPath = path.join(outputDir, `portrait_${slug}.png`);

  if (!regenPortraits && existsSync(cachePath)) {
    console.log(`[generate-portraits] ${character.name} — using cached portrait`);
    await copyFile(cachePath, outputPath);
    return { name: character.name, avatarUrl: outputPath };
  }

  // Check GCS before generating
  if (!regenPortraits) {
    await mkdir(PORTRAITS_CACHE_DIR, { recursive: true });
    const downloaded = await downloadPortrait(slug, cachePath);
    if (downloaded) {
      console.log(`[generate-portraits] ${character.name} — downloaded from GCS`);
      await copyFile(cachePath, outputPath);
      return { name: character.name, avatarUrl: outputPath };
    }
  }

  console.log(`[generate-portraits] ${character.name} — fetching avatar...`);
  let avatarData: string;
  let mimeType: string;
  try {
    const response = await fetch(character.avatarUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    avatarData = Buffer.from(await response.arrayBuffer()).toString('base64');
  } catch (err) {
    console.warn(`[generate-portraits] ${character.name} — avatar fetch failed: ${err}, falling back to original avatar`);
    return { name: character.name, avatarUrl: character.avatarUrl };
  }

  console.log(`[generate-portraits] ${character.name} — generating portrait...`);
  try {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        { text: `${character.name}:` },
        { inlineData: { mimeType, data: avatarData } },
        { text: buildPortraitPrompt(character) },
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '9:16' },
      },
    });

    const parts = result.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => 'inlineData' in p && p.inlineData?.data);
    if (!imagePart || !('inlineData' in imagePart) || !imagePart.inlineData?.data) {
      throw new Error('no image in response');
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    await writeFile(outputPath, imageBuffer);
    console.log(`[generate-portraits] ${character.name} — saved ${outputPath} (${imageBuffer.length} bytes)`);

    await mkdir(PORTRAITS_CACHE_DIR, { recursive: true });
    await copyFile(outputPath, cachePath);
    console.log(`[generate-portraits] ${character.name} — cached to ${cachePath}`);

    if (config.gcsBucketAssets) {
      try {
        await uploadPortrait(cachePath, slug);
        console.log(`[generate-portraits] ${character.name} — uploaded portrait to GCS`);
      } catch (err) {
        console.warn(`[generate-portraits] ${character.name} — GCS upload failed: ${err}`);
      }
    }

    return { name: character.name, avatarUrl: outputPath };
  } catch (err) {
    console.warn(`[generate-portraits] ${character.name} — generation failed: ${err}, falling back to original avatar`);
    return { name: character.name, avatarUrl: character.avatarUrl };
  }
}

export async function generatePortraits(
  characters: CharacterForPortrait[],
  outputDir: string,
  regenPortraits = false,
): Promise<CharacterAvatar[]> {
  requireConfig(['geminiApiKey']);
  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const results = await Promise.allSettled(
    characters.map((c) => generatePortrait(client, c, outputDir, regenPortraits)),
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[generate-portraits] ${characters[i]!.name} — unexpected error: ${r.reason}, falling back`);
    return { name: characters[i]!.name, avatarUrl: characters[i]!.avatarUrl };
  });
}
