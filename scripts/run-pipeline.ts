#!/usr/bin/env tsx
import 'dotenv/config';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { runPipeline } from '../src/pipeline/index.js';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'audio-dir': { type: 'string' },
    'output-dir': { type: 'string' },
    'campaign': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'skip-upload': { type: 'boolean', default: false },
    'skip-deliver': { type: 'boolean', default: false },
    'skip-db': { type: 'boolean', default: false },
    'use-transcript': { type: 'string' },
    'help': { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

if (values['help']) {
  console.log(`
Usage: npm run pipeline -- --audio-dir <dir> [options]

Options:
  --audio-dir <dir>     Directory containing per-user audio tracks (required)
  --output-dir <dir>    Output directory (default: ./output/<timestamp>)
  --campaign <path>     Path to campaign.json (default: ./data/campaign.json)
  --dry-run             Stop after moment selection (no video generation)
  --skip-upload         Skip GCS upload steps (local dev without GCP)
  --skip-deliver        Skip Discord delivery
  --skip-db             Skip Cloud SQL (local dev without GCP)
  --use-transcript <path>  Use existing utterances.json, skip steps 1-3
  --help                Show this help
`);
  process.exit(0);
}

const audioDir = values['audio-dir'];
if (!audioDir) {
  console.error('Error: --audio-dir is required');
  process.exit(1);
}

const outputDir = values['output-dir'] ?? path.join('output', new Date().toISOString().replace(/[:.]/g, '-'));
const campaignContextPath = values['campaign'] ?? path.join('data', 'campaign.json');

await runPipeline({
  audioDir,
  outputDir,
  campaignContextPath,
  dryRun: values['dry-run'],
  skipUpload: values['skip-upload'],
  skipDeliver: values['skip-deliver'],
  skipDb: values['skip-db'],
  useTranscript: values['use-transcript'],
});
