#!/usr/bin/env tsx
import 'dotenv/config';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { runPipeline } from '../src/pipeline/index.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'session': { type: 'string' },
    'output-dir': { type: 'string' },
    'campaign': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'skip-upload': { type: 'boolean', default: false },
    'skip-deliver': { type: 'boolean', default: false },
'skip-text-chat': { type: 'boolean', default: false },
    'from-narrative': { type: 'string' },
    'reference-image': { type: 'string' },
    'narrative-mode': { type: 'string' },
    'skip-portrait-gen': { type: 'boolean', default: false },
    'regen-portraits': { type: 'boolean', default: false },
    'note': { type: 'string' },
    'help': { type: 'boolean', default: false },
  },
});

if (values['help']) {
  console.log(`
Usage: npm run pipeline -- --session <dir> [options]

Options:
  --session <dir>       Path to session directory (e.g. data/sessions/2026-02-07)
                        Audio is read from <dir>/audio/
                        If <dir>/utterances.json exists, transcription is skipped
  --output-dir <dir>    Output directory (default: ./output/<timestamp>)
  --campaign <path>     Path to campaign.json (default: ./data/campaign.json)
  --dry-run             Stop after moment selection (no video generation)
  --skip-upload         Skip GCS upload steps (local dev without GCP)
  --skip-deliver        Skip Discord delivery
--from-narrative <dir>    Resume from existing narrative output dir (skip steps 1-6)
  --reference-image <path>  Group portrait passed to Veo as a reference image
  --narrative-mode <mode>   Narrative generation mode: single (default) or multi
  --skip-portrait-gen       Skip portrait generation, use raw DnD Beyond avatars
  --regen-portraits         Ignore portrait cache and regenerate all portraits
  --skip-text-chat          Skip Discord text chat ingestion
  --note <text>             Extra instructions injected into the moment-selection
                            and narrative prompts for this run. For longer notes:
                            --note "$(cat my-notes.txt)"
  --help                Show this help
`);
  process.exit(0);
}

const sessionId = values['session'];
if (!sessionId && !values['from-narrative']) {
  console.error('Error: --session <dir> is required (or use --from-narrative to resume from step 7)');
  process.exit(1);
}

const narrativeMode = (values['narrative-mode'] === 'multi' ? 'multi' : 'single') as 'single' | 'multi';
const outputDir = values['output-dir'] ?? path.join('output', `${new Date().toISOString().replace(/[:.]/g, '-')}_${narrativeMode}`);
const campaignContextPath = values['campaign'] ?? path.join('data', 'campaign.json');

const sessionDir = sessionId ?? null;
const audioDir = sessionDir ? path.join(sessionDir, 'audio') : '';
const transcriptPath = sessionDir ? path.join(sessionDir, 'utterances.json') : null;
const fromTranscript = transcriptPath && existsSync(transcriptPath) ? transcriptPath : undefined;

if (fromTranscript) {
  console.log(`[pipeline] Found existing transcript — skipping steps 1-3`);
}

await runPipeline({
  sessionId: sessionId ? path.basename(sessionId) : path.basename(outputDir),
  audioDir,
  outputDir,
  campaignContextPath,
  dryRun: values['dry-run'],
  skipUpload: values['skip-upload'],
  skipDeliver: values['skip-deliver'],
...(fromTranscript && { fromTranscript }),
  ...(values['from-narrative'] && { fromNarrative: values['from-narrative'] }),
  ...(values['reference-image'] && { referenceImagePath: values['reference-image'] }),
  narrativeMode,
  skipPortraitGen: values['skip-portrait-gen'],
  regenPortraits: values['regen-portraits'],
  skipTextChat: values['skip-text-chat'],
  ...(values['note'] && { promptNote: values['note'] }),
});
