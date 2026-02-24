import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { mergeAudio } from './merge-audio.js';
import { uploadAudioFile } from './upload-audio.js';
import { transcribe } from './transcribe.js';
import { selectMoments } from './select-moments.js';
import { generateNarrative } from './generate-narrative.js';
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
  skipUpload?: boolean;   // skip GCS upload steps (for local dev without GCP)
  skipDeliver?: boolean;  // skip Discord delivery
  skipDb?: boolean;       // skip Cloud SQL (for local dev)
}

export async function runPipeline(opts: PipelineOptions): Promise<void> {
  const { audioDir, outputDir, campaignContextPath, dryRun = false } = opts;

  await mkdir(outputDir, { recursive: true });

  // Load campaign context
  const { readFile } = await import('node:fs/promises');
  const campaignContext = await readFile(campaignContextPath, 'utf-8');

  console.log('\n═══════════════════════════════════════');
  console.log('  Scrying Glass — Session Recap Pipeline');
  console.log('═══════════════════════════════════════\n');

  // ── Step 1: Merge audio ─────────────────────────────────────────────────────
  console.log('Step 1/10: Merging audio tracks...');
  const mergedPath = path.join(outputDir, 'session_multichannel.m4a');
  const { channelMap } = await mergeAudio(audioDir, mergedPath);

  // ── Step 2: Upload to GCS ───────────────────────────────────────────────────
  let audioUrl = mergedPath;
  if (!opts.skipUpload) {
    console.log('\nStep 2/10: Uploading audio to GCS...');
    audioUrl = await uploadAudioFile(mergedPath);
  } else {
    console.log('\nStep 2/10: Skipping GCS upload (--skip-upload)');
  }

  // ── Step 3: Transcribe ──────────────────────────────────────────────────────
  console.log('\nStep 3/10: Transcribing...');
  const { utterances, transcriptText } = await transcribe(mergedPath, channelMap, outputDir);

  // ── Step 4: Select moments ──────────────────────────────────────────────────
  console.log('\nStep 4/10: Selecting moments...');
  const moments = await selectMoments(utterances, campaignContext);

  if (dryRun) {
    console.log('\n[dry-run] Stopping after moment selection.');
    return;
  }

  // ── Step 5: Generate narrative ──────────────────────────────────────────────
  console.log('\nStep 5/10: Generating narrative + illustrations...');
  const narrative = await generateNarrative(transcriptText, moments, campaignContext, outputDir);

  // ── Step 6: Generate TTS ────────────────────────────────────────────────────
  console.log('\nStep 6/10: Synthesizing narration audio...');
  const narrationPaths = await generateTts(narrative, outputDir);

  // ── Step 7: Generate video clips ────────────────────────────────────────────
  console.log('\nStep 7/10: Generating video clips...');
  const videoPaths = await generateVideos(moments);

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
