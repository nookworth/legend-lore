import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeAudio } from './merge-audio.js';
import { uploadAudioFile } from './upload-audio.js';
import { transcribe } from './transcribe.js';
import { selectMoments } from './select-moments.js';
import type { Utterance, MomentCandidate, Narrative } from '../shared/types.js';
import { generateNarrative, type CharacterAvatar } from './generate-narrative.js';
import { generatePortraits, type CharacterForPortrait, ALIGNMENT_MAP } from './generate-portraits.js';
import { generateTts } from './generate-tts.js';
import { stitchVideo } from './stitch-video.js';
import { uploadOutput } from './upload-output.js';
import { deliver } from './deliver.js';

export interface PipelineOptions {
  sessionId: string;
  audioDir: string;
  outputDir: string;
  campaignContextPath: string;
  dryRun?: boolean;
  skipUpload?: boolean;    // skip GCS upload steps (for local dev without GCP)
  skipDeliver?: boolean;   // skip Discord delivery
  skipDb?: boolean;        // skip Cloud SQL (for local dev)
  fromTranscript?: string;  // path to existing utterances.json — resumes from step 4
  fromNarrative?: string;   // path to existing output dir — resumes from step 7
  referenceImagePath?: string; // optional group portrait for Veo reference image
  narrativeMode?: 'single' | 'multi'; // single = one combined prompt (default), multi = per-segment
  skipPortraitGen?: boolean;   // skip portrait generation, use raw DnD Beyond avatars directly
  regenPortraits?: boolean;    // ignore cache and regenerate all portraits
}

interface CampaignJson {
  campaign: string;
  characters: Array<{
    name: string;
    race: string;
    classes: Array<{ name: string; subclassName?: string }>;
    personalityTraits?: string | null;
    spells?: string[][];
    avatar?: string | null;
    alignmentId?: number | null;
    gender?: string | null;
    age?: string | null;
    height?: string | null;
    weight?: string | null;
    hair?: string | null;
    eyes?: string | null;
    skin?: string | null;
    equipment?: Array<{ name: string; type: string }>;
  }>;
}

const WINDOW_MS = 5 * 60 * 1000;

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatUtteranceWindow(utterances: Utterance[], windowMs: number, fromEnd = false): string {
  const totalDuration = utterances.at(-1)?.end ?? 0;
  const filtered = fromEnd
    ? utterances.filter((u) => u.start >= totalDuration - windowMs)
    : utterances.filter((u) => u.start < windowMs);
  return filtered.map((u) => `[${formatTime(u.start)}] ${u.speaker}: ${u.text}`).join('\n');
}

function formatCampaignContext(raw: string): string {
  const data = JSON.parse(raw) as CampaignJson;
  const lines: string[] = [`Campaign: ${data.campaign}`, 'Characters:'];
  for (const c of data.characters) {
    const classes = c.classes.map((cl) => `${cl.name}${cl.subclassName ? ` (${cl.subclassName})` : ''}`).join(' / ');
    lines.push(`- ${c.name} (${c.race} ${classes})`);
    const appearance = [c.gender, c.height, c.hair ? `${c.hair} hair` : null, c.eyes ? `${c.eyes} eyes` : null, c.skin ? `${c.skin} skin` : null].filter(Boolean).join(', ');
    if (appearance) lines.push(`  Appearance: ${appearance}`);
    const spells = c.spells?.flat().filter(Boolean) ?? [];
    if (spells.length) lines.push(`  Spells: ${spells.join(', ')}`);
    if (c.personalityTraits) lines.push(`  Personality: ${c.personalityTraits.split('\n')[0]}`);
  }
  return lines.join('\n');
}

function extractCharacterAvatars(raw: string): CharacterAvatar[] {
  const data = JSON.parse(raw) as CampaignJson;
  return data.characters.filter((c) => c.avatar).map((c) => ({ name: c.name, avatarUrl: c.avatar! }));
}

function extractCharactersForPortrait(raw: string): CharacterForPortrait[] {
  const data = JSON.parse(raw) as CampaignJson;
  return data.characters.filter((c) => c.avatar).map((c) => ({
    name: c.name,
    avatarUrl: c.avatar!,
    race: c.race,
    classes: c.classes.map((cl) => `${cl.name}${cl.subclassName ? ` (${cl.subclassName})` : ''}`).join(' / '),
    alignment: c.alignmentId ? ALIGNMENT_MAP[c.alignmentId] : null,
    gender: c.gender,
    age: c.age,
    height: c.height,
    weight: c.weight,
    hair: c.hair,
    eyes: c.eyes,
    skin: c.skin,
    equipment: (c.equipment ?? []).map((e) => e.name),
  }));
}

export async function runPipeline(opts: PipelineOptions): Promise<void> {
  const { sessionId, audioDir, outputDir, campaignContextPath, dryRun = false } = opts;

  await mkdir(outputDir, { recursive: true });

  const campaignContext = await readFile(campaignContextPath, 'utf-8');
  const campaignContextFormatted = formatCampaignContext(campaignContext);
  const rawAvatars = extractCharacterAvatars(campaignContext);
  const charactersForPortrait = extractCharactersForPortrait(campaignContext);

  const playerMapPath = path.join(path.dirname(campaignContextPath), 'player_map.json');
  let playerMap: Record<string, string> = {};
  try {
    playerMap = JSON.parse(await readFile(playerMapPath, 'utf-8')) as Record<string, string>;
    console.log(`[pipeline] Loaded player map: ${Object.keys(playerMap).length} entries`);
  } catch {
    console.log('[pipeline] No player_map.json found — speaker labels will not be mapped to character names');
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  Legend Lore — Session Recap Pipeline');
  console.log('═══════════════════════════════════════\n');

  let utterances: Utterance[];
  let transcriptText: string;

  if (opts.fromNarrative) {
    console.log('Steps 1-3/10: Skipping (--from-narrative)');
    utterances = [];
    transcriptText = '';
  } else if (opts.fromTranscript) {
    console.log(`Steps 1-3/10: Resuming from transcript: ${opts.fromTranscript}`);
    utterances = JSON.parse(await readFile(opts.fromTranscript, 'utf-8')) as Utterance[];
    transcriptText = utterances.map((u) => `[${u.speaker}] ${u.text}`).join('\n');
  } else {
    // ── Step 1: Merge audio ─────────────────────────────────────────────────
    console.log('Step 1/10: Merging audio tracks...');
    const mergedPath = path.join(outputDir, 'session_multichannel.m4a');
    const { channelMap } = await mergeAudio(audioDir, mergedPath);

    // ── Step 2: Upload to GCS ───────────────────────────────────────────────
    if (!opts.skipUpload) {
      console.log('\nStep 2/10: Uploading audio to GCS...');
      await uploadAudioFile(mergedPath, sessionId);
    } else {
      console.log('\nStep 2/10: Skipping GCS upload (--skip-upload)');
    }

    // ── Step 3: Transcribe ──────────────────────────────────────────────────
    console.log('\nStep 3/10: Transcribing...');
    ({ utterances, transcriptText } = await transcribe(mergedPath, channelMap, outputDir));

    // Persist utterances to data/sessions/<sessionId>/ so they survive output dir cleanup
    const sessionDir = path.join('data', 'sessions', sessionId);
    await mkdir(sessionDir, { recursive: true });
    const transcriptBackupPath = path.join(sessionDir, 'utterances.json');
    await writeFile(transcriptBackupPath, JSON.stringify(utterances, null, 2));
    console.log(`[transcribe] Backed up utterances → ${transcriptBackupPath}`);
  }

  let moments: MomentCandidate[];
  let narrative: Narrative;
  let narrationPaths: string[];

  if (opts.fromNarrative) {
    // ── Steps 4-7: Skipped (resuming from video generation) ─────────────────
    const srcDir = opts.fromNarrative;
    console.log(`Steps 4-7/10: Using existing narrative from: ${srcDir}`);
    moments = JSON.parse(await readFile(path.join(srcDir, 'moments.json'), 'utf-8')) as MomentCandidate[];
    const narrativeJson = JSON.parse(await readFile(path.join(srcDir, 'narrative.json'), 'utf-8')) as Record<string, string>;
    narrative = await Promise.all(
      Object.entries(narrativeJson).map(async ([label, text]) => ({
        label,
        text,
        image: await readFile(path.join(srcDir, `narrative_${label}.png`)),
      })),
    );
    narrationPaths = narrative.map((s) => path.join(srcDir, `narration_${s.label}.mp3`));
  } else {
    // ── Step 4: Select moments ───────────────────────────────────────────────
    console.log('\nStep 4/10: Selecting moments...');
    moments = await selectMoments(utterances!, campaignContext, outputDir, playerMap);
    // Rank determines which moments to include; start_time determines reel order.
    moments.sort((a, b) => a.rank - b.rank);
    const top3 = moments.slice(0, 3).sort((a, b) => a.start_time - b.start_time);
    moments = [...top3, ...moments.slice(3)];

    if (dryRun) {
      console.log('\n[dry-run] Stopping after moment selection.');
      return;
    }

    // ── Step 5: Generate character portraits ─────────────────────────────────
    let characterAvatars = rawAvatars;
    if (!opts.skipPortraitGen) {
      console.log('\nStep 5/10: Generating character portraits...');
      characterAvatars = await generatePortraits(charactersForPortrait, outputDir, opts.regenPortraits);
    } else {
      console.log('\nStep 5/10: Skipping portrait generation (--skip-portrait-gen)');
    }

    // ── Step 6: Generate narrative ───────────────────────────────────────────
    console.log('\nStep 6/10: Generating narrative + illustrations...');
    const sessionBookends = utterances.length
      ? { sessionStart: formatUtteranceWindow(utterances, WINDOW_MS), sessionEnd: formatUtteranceWindow(utterances, WINDOW_MS, true) }
      : undefined;
    narrative = await generateNarrative(moments, campaignContextFormatted, outputDir, characterAvatars, sessionBookends, opts.narrativeMode);

    // ── Step 7: Generate TTS ─────────────────────────────────────────────────
    console.log('\nStep 7/10: Synthesizing narration audio...');
    narrationPaths = await generateTts(narrative, outputDir);
  }

  // ── Step 8: Stitch final video ──────────────────────────────────────────────
  console.log('\nStep 8/10: Stitching final video...');
  const finalPath = path.join(outputDir, 'final_recap.mp4');
  await stitchVideo(narrative, narrationPaths, finalPath, outputDir);

  // ── Step 9: Upload output ───────────────────────────────────────────────────
  let finalUrl = finalPath;
  if (!opts.skipUpload) {
    console.log('\nStep 9/10: Uploading final video to GCS...');
    finalUrl = await uploadOutput(finalPath, sessionId);
  } else {
    console.log('\nStep 9/10: Skipping GCS upload (--skip-upload)');
  }

  // ── Step 10: Deliver to Discord ─────────────────────────────────────────────
  if (!opts.skipDeliver) {
    console.log('\nStep 10/10: Delivering to Discord...');
    await deliver(finalUrl);
  } else {
    console.log('\nStep 10/10: Skipping Discord delivery (--skip-deliver)');
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  Done! Recap saved to: ${finalPath}`);
  if (finalUrl !== finalPath) console.log(`  GCS: ${finalUrl}`);
  console.log('═══════════════════════════════════════\n');
}
