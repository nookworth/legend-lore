#!/usr/bin/env tsx
/**
 * Generates a character portrait using Gemini image generation.
 * Output is intended as a reference image for Veo video generation.
 *
 * Usage:
 *   tsx scripts/gen-character-portrait.ts                    # group portrait
 *   tsx scripts/gen-character-portrait.ts --character Soren  # single portrait
 *   tsx scripts/gen-character-portrait.ts --out output/party.png --prompt "..."
 */

import 'dotenv/config';
import { GoogleGenAI, type Part } from '@google/genai';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'character':   { type: 'string' },
    'avatars-dir': { type: 'string', default: 'data/avatars' },
    'campaign':    { type: 'string', default: 'data/campaign.json' },
    'out':         { type: 'string' },
    'prompt':      { type: 'string' },
  },
});

const avatarsDir   = values['avatars-dir']!;
const campaignFile = values['campaign']!;
const characterFlag = values['character'];

const REFERENCE_PURPOSE =
  'This image will be used as a visual reference for AI video generation and story card illustration. ' +
  'Show each character from head to toe — full body, including feet. Do not crop at the waist, knees, or any other point. ' +
  'Render faces, clothing, armor, weapons, and colors with high fidelity so likenesses remain consistent across generated scenes. ' +
  'Use a neutral pose and even lighting to ensure all features are clearly visible.';

const GROUP_PROMPT =
  'A hand-drawn fantasy group portrait of these adventurers together. ' +
  'Dragonlance aesthetic, retro Dungeons and Dragons art aesthetic, dramatic lighting. ' +
  `Render each character faithfully according to their description and reference portrait. ${REFERENCE_PURPOSE}`;

const SINGLE_PROMPT =
  'A hand-drawn fantasy portrait of this adventurer. ' +
  'Dragonlance aesthetic, retro Dungeons and Dragons art aesthetic, dramatic lighting, detailed face matching the reference portrait exactly. ' +
  REFERENCE_PURPOSE;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.webp': 'image/webp',
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

/** Find a local avatar file whose basename matches somewhere in the character name. */
function findAvatarFile(avatarsDir: string, characterName: string): string | null {
  const normalizedName = characterName.toLowerCase();
  const files = fs.readdirSync(avatarsDir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) continue;
    const basename = path.basename(file, ext).replace(/-/g, ' ');
    if (normalizedName.includes(basename)) return file;
  }
  return null;
}

function loadAvatar(avatarsDir: string, filename: string): Part {
  const ext = path.extname(filename).toLowerCase();
  return {
    inlineData: {
      mimeType: MIME[ext] ?? 'image/jpeg',
      data: fs.readFileSync(path.join(avatarsDir, filename)).toString('base64'),
    },
  };
}

async function main() {
  const campaign = JSON.parse(fs.readFileSync(campaignFile, 'utf-8')) as {
    characters: Record<string, unknown>[];
  };

  const allCharacters = campaign.characters;

  const characters = characterFlag
    ? allCharacters.filter(c =>
        (c['name'] as string).toLowerCase().includes(characterFlag.toLowerCase())
      )
    : allCharacters;

  if (characters.length === 0) {
    const names = allCharacters.map(c => c['name']).join(', ');
    console.error(`No character matching "${characterFlag}". Available: ${names}`);
    process.exit(1);
  }

  const isGroup = characters.length > 1;
  const slug = isGroup ? 'party' : (characters[0]!['name'] as string).toLowerCase().replace(/\s+/g, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = values['out'] ?? `output/reference-images/${slug}-portrait-${timestamp}.png`;

  console.log(isGroup
    ? `Generating group portrait for: ${characters.map(c => c['name']).join(', ')}`
    : `Generating single portrait for: ${characters[0]!['name']}`);

  const basePrompt = values['prompt'] ?? (isGroup ? GROUP_PROMPT : SINGLE_PROMPT);
  const bioBlock = characters.map(c => JSON.stringify(c, null, 2)).join('\n\n');
  const fullPrompt = `${basePrompt}\n\nCharacter data:\n${bioBlock}`;

  console.log(`\nPrompt:\n${fullPrompt}\n`);

  // Prompt + one avatar image per character (skips characters without a local avatar)
  const parts: Part[] = [{ text: fullPrompt }];
  for (const c of characters) {
    const name = c['name'] as string;
    const file = findAvatarFile(avatarsDir, name);
    if (file) {
      parts.push(loadAvatar(avatarsDir, file));
      console.log(`Avatar: ${file} → ${name}`);
    } else {
      console.warn(`No local avatar found for ${name}, skipping image.`);
    }
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: parts,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: isGroup ? '4:3' : '2:3',
      },
    },
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) {
      console.log(part.text);
    } else if (part.inlineData?.data) {
      const ext = part.inlineData.mimeType?.split('/')[1] ?? 'png';
      const finalPath = outPath.replace(/\.[^.]+$/, `.${ext}`);
      fs.writeFileSync(finalPath, Buffer.from(part.inlineData.data, 'base64'));
      console.log(`Saved → ${finalPath}`);
    }
  }
}

main().catch(err => {
  console.error(err?.message ?? err);
  process.exit(1);
});
