import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeAudio } from './merge-audio.js';
import { uploadAudioFile } from './upload-audio.js';
import { transcribe } from './transcribe.js';
import { selectMoments } from './select-moments.js';
import type { Utterance, MomentCandidate, Narrative } from '../shared/types.js';
import { generateNarrative, type CharacterAvatar } from './generate-narrative.js';
import { generateTts } from './generate-tts.js';
import { generateVideos } from './generate-video.js';
import { stitchVideo } from './stitch-video.js';
import { uploadOutput } from './upload-output.js';
import { deliver } from './deliver.js';

export interface PipelineOptions {
  audioDir: string;
  outputDir: string;
  campaignContextPath: string;
  dryRun?: boolean;
  skipUpload?: boolean;    // skip GCS upload steps (for local dev without GCP)
  skipDeliver?: boolean;   // skip Discord delivery
  skipDb?: boolean;        // skip Cloud SQL (for local dev)
  fromTranscript?: string;  // path to existing utterances.json — resumes from step 4
  fromNarrative?: string;   // path to existing output dir — resumes from step 7
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
    hair?: string | null;
    eyes?: string | null;
    skin?: string | null;
    height?: string | null;
    gender?: string | null;
  }>;
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

export async function runPipeline(opts: PipelineOptions): Promise<void> {
  const { audioDir, outputDir, campaignContextPath, dryRun = false } = opts;

  await mkdir(outputDir, { recursive: true });

  const campaignContext = await readFile(campaignContextPath, 'utf-8');
  const campaignContextFormatted = formatCampaignContext(campaignContext);
  const characterAvatars = extractCharacterAvatars(campaignContext);

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
      await uploadAudioFile(mergedPath);
    } else {
      console.log('\nStep 2/10: Skipping GCS upload (--skip-upload)');
    }

    // ── Step 3: Transcribe ──────────────────────────────────────────────────
    console.log('\nStep 3/10: Transcribing...');
    ({ utterances, transcriptText } = await transcribe(mergedPath, channelMap, outputDir));

    // Persist utterances to data/transcripts/ so they survive output dir cleanup
    const transcriptsDir = path.join('data', 'transcripts');
    await mkdir(transcriptsDir, { recursive: true });
    const transcriptBackupPath = path.join(transcriptsDir, `${path.basename(audioDir)}_utterances.json`);
    await writeFile(transcriptBackupPath, JSON.stringify(utterances, null, 2));
    console.log(`[transcribe] Backed up utterances → ${transcriptBackupPath}`);
  }

  let moments: MomentCandidate[];
  let narrative: Narrative;
  let narrationPaths: string[];

  if (opts.fromNarrative) {
    // ── Steps 4-6: Skipped (resuming from video generation) ─────────────────
    const srcDir = opts.fromNarrative;
    console.log(`Steps 4-6/10: Using existing narrative from: ${srcDir}`);
    moments = JSON.parse(await readFile(path.join(srcDir, 'moments.json'), 'utf-8')) as MomentCandidate[];
    const narrativeJson = JSON.parse(await readFile(path.join(srcDir, 'narrative.json'), 'utf-8')) as { intro: string; bridges: string[]; outro: string };
    const loadSegment = async (label: string, text: string) => ({
      text,
      image: await readFile(path.join(srcDir, `narrative_${label}.png`)),
    });
    narrative = {
      intro: await loadSegment('intro', narrativeJson.intro),
      bridges: await Promise.all(narrativeJson.bridges.map((t, i) => loadSegment(`bridge_${i + 1}`, t))),
      outro: await loadSegment('outro', narrativeJson.outro),
    };
    const labels = ['narration_intro', ...narrativeJson.bridges.map((_, i) => `narration_bridge_${i}`), 'narration_outro'];
    narrationPaths = labels.map((l) => path.join(srcDir, `${l}.mp3`));
  } else {
    // ── Step 4: Select moments ───────────────────────────────────────────────
    console.log('\nStep 4/10: Selecting moments...');
    moments = await selectMoments(utterances!, campaignContext, outputDir);
    // Rank determines which moments to include; start_time determines reel order.
    moments.sort((a, b) => a.rank - b.rank);
    const top3 = moments.slice(0, 3).sort((a, b) => a.start_time - b.start_time);
    moments = [...top3, ...moments.slice(3)];

    if (dryRun) {
      console.log('\n[dry-run] Stopping after moment selection.');
      return;
    }

    // ── Step 5: Generate narrative ───────────────────────────────────────────
    console.log('\nStep 5/10: Generating narrative + illustrations...');
    narrative = await generateNarrative(moments, campaignContextFormatted, outputDir, characterAvatars);

    // ── Step 6: Generate TTS ─────────────────────────────────────────────────
    console.log('\nStep 6/10: Synthesizing narration audio...');
    narrationPaths = await generateTts(narrative, outputDir);
  }

  // ── Step 7: Generate video clips ────────────────────────────────────────────
  console.log('\nStep 7/10: Generating video clips...');
  const videoPaths = await generateVideos(moments, outputDir);

  // ── Step 8: Stitch final video ──────────────────────────────────────────────
  console.log('\nStep 8/10: Stitching final video...');
  const finalPath = path.join(outputDir, 'final_recap.mp4');
  await stitchVideo(narrative, narrationPaths, videoPaths, finalPath, outputDir);

  // ── Step 9: Upload output ───────────────────────────────────────────────────
  let finalUrl = finalPath;
  if (!opts.skipUpload) {
    console.log('\nStep 9/10: Uploading final video to GCS...');
    finalUrl = await uploadOutput(finalPath);
  } else {
    console.log('\nStep 9/10: Skipping GCS upload (--skip-upload)');
  }

  // ── Step 10: Deliver to Discord ─────────────────────────────────────────────
  if (!opts.skipDeliver) {
    console.log('\nStep 10/10: Delivering to Discord...');
    await deliver(finalPath);
  } else {
    console.log('\nStep 10/10: Skipping Discord delivery (--skip-deliver)');
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`  Done! Recap saved to: ${finalPath}`);
  if (finalUrl !== finalPath) console.log(`  GCS: ${finalUrl}`);
  console.log('═══════════════════════════════════════\n');
}
