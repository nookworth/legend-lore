/**
 * Cloud Run Job entrypoint.
 *
 * Downloads session data from GCS (using ADC from the attached service account),
 * then runs the full Legend Lore pipeline.
 *
 * Required env vars:
 *   SESSION_ID           - unique session identifier (e.g. "2026-02-07")
 *
 * One of the following must also be set:
 *   GCS_UTTERANCES_URI   - gs:// URI of utterances.json — skips steps 1-3 (transcription)
 *                          e.g. gs://my-audio-bucket/my-group/sessions/2026-02-07/utterances.json
 *   GCS_SOURCE_PREFIX    - gs:// URI prefix of folder containing raw per-user audio tracks
 *                          e.g. gs://my-audio-bucket/my-group/sessions/2026-02-07/source/
 *                          Runs the full pipeline including merge, upload, and transcription.
 *
 * Optional:
 *   NARRATIVE_MODE       - 'single' (default) | 'multi'
 */

import 'dotenv/config';
import { Storage } from '@google-cloud/storage';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { runPipeline } from '../src/pipeline/index.js';

const sessionId = process.env['SESSION_ID'];
if (!sessionId) throw new Error('[cloud-run-job] SESSION_ID env var is required');

const gcsUtterancesUri = process.env['GCS_UTTERANCES_URI'];
const gcsSourcePrefix = process.env['GCS_SOURCE_PREFIX'];

if (!gcsUtterancesUri && !gcsSourcePrefix) {
  throw new Error(
    '[cloud-run-job] Set GCS_UTTERANCES_URI (skip transcription) or GCS_SOURCE_PREFIX (full pipeline)',
  );
}

const SESSION_DIR = '/tmp/session-data';
const AUDIO_DIR = path.join(SESSION_DIR, 'audio');
mkdirSync(AUDIO_DIR, { recursive: true });

function parseGcsUri(uri: string): { bucket: string; filePath: string } {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid GCS URI: ${uri}`);
  return { bucket: match[1]!, filePath: match[2]! };
}

const gcs = new Storage();

async function downloadFile(uri: string, dest: string): Promise<void> {
  const { bucket, filePath } = parseGcsUri(uri);
  await gcs.bucket(bucket).file(filePath).download({ destination: dest });
  console.log(`[cloud-run-job] Downloaded ${uri} → ${dest}`);
}

async function downloadFolder(prefixUri: string, destDir: string): Promise<void> {
  const { bucket, filePath: prefix } = parseGcsUri(prefixUri);
  const [files] = await gcs.bucket(bucket).getFiles({ prefix });
  if (files.length === 0) throw new Error(`No files found at ${prefixUri}`);
  for (const file of files) {
    const localPath = path.join(destDir, path.basename(file.name));
    await file.download({ destination: localPath });
    console.log(`[cloud-run-job] Downloaded gs://${bucket}/${file.name} → ${localPath}`);
  }
}

let fromTranscript: string | undefined;

if (gcsUtterancesUri) {
  console.log('[cloud-run-job] Downloading utterances.json (will skip steps 1-3)...');
  const utterancesPath = path.join(SESSION_DIR, 'utterances.json');
  await downloadFile(gcsUtterancesUri, utterancesPath);
  fromTranscript = utterancesPath;
} else if (gcsSourcePrefix) {
  console.log('[cloud-run-job] Downloading source audio tracks (full pipeline)...');
  await downloadFolder(gcsSourcePrefix, AUDIO_DIR);
}

const narrativeMode = (process.env['NARRATIVE_MODE'] ?? 'single') as 'single' | 'multi';

await runPipeline({
  sessionId,
  audioDir: AUDIO_DIR,
  outputDir: `/tmp/output/${sessionId}`,
  campaignContextPath: '/app/data/campaign.json',
...(fromTranscript && { fromTranscript }),
  narrativeMode,
  skipPortraitGen: false,
  regenPortraits: false,
});
