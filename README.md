# Legend Lore

Automated D&D session recap generator. Feeds raw session audio through a 10-step pipeline to produce a narrated, illustrated video recap delivered to Discord.

**Hackathon category**: Creative Storyteller — uses Gemini 2.0 Flash with interleaved `TEXT` + `IMAGE` output modalities to generate narration and illustrated title cards in a single model call.

---

## Pipeline overview

| Step | What happens |
|------|-------------|
| 1 | Merge per-user audio tracks (ffmpeg join filter) |
| 2 | Upload merged audio to GCS |
| 3 | Transcribe with AssemblyAI (multichannel, speaker-attributed) |
| 4 | Select highlight moments (Gemini structured output) |
| 5 | Generate character portraits (Gemini image generation) |
| 6 | Generate narrative + illustrated title cards (Gemini interleaved TEXT + IMAGE) |
| 7 | Synthesize narration audio (Google Cloud TTS) |
| 8 | Stitch final video (ffmpeg) |
| 9 | Upload final video to GCS |
| 10 | Deliver to Discord |

---

## Running the pipeline

Two sessions from a real D&D campaign are available. Each can be run from a pre-built
transcript (skipping AssemblyAI transcription) or from raw audio (full pipeline).

| Session | Date |
|---------|------|
| `2026-02-07` | February 7, 2026 |
| `2026-02-27` | February 27, 2026 |

Output is delivered to the [#session-recaps Discord channel](https://discord.gg/INVITE_LINK)
and uploaded to `gs://legend-lore-video/1/sessions/{SESSION_ID}/final_recap.mp4`.

---

### Option 1 — Cloud Run (no clone needed)

The pipeline is deployed as a Cloud Run Job on the project's GCP infrastructure.
No API keys or GCP project setup required — just `gcloud` CLI.

**One-time setup:**

```bash
# Install gcloud CLI: https://cloud.google.com/sdk/docs/install

# Download and activate the judge service account
curl -o judge-key.json https://storage.googleapis.com/legend-lore-assets/judge-key.json
gcloud auth activate-service-account --key-file=judge-key.json
gcloud config set project legend-lore
```

**Run from transcript** (skips transcription — faster, no AssemblyAI cost):

```bash
# February 7 session
gcloud run jobs execute legend-lore-pipeline \
  --region=us-central1 \
  --update-env-vars='SESSION_ID=2026-02-07,GCS_UTTERANCES_URI=gs://legend-lore-audio/1/sessions/2026-02-07/utterances.json'

# February 27 session
gcloud run jobs execute legend-lore-pipeline \
  --region=us-central1 \
  --update-env-vars='SESSION_ID=2026-02-27,GCS_UTTERANCES_URI=gs://legend-lore-audio/1/sessions/2026-02-27/utterances.json'
```

**Run from raw audio** (full pipeline including transcription):

```bash
gcloud run jobs execute legend-lore-pipeline \
  --region=us-central1 \
  --update-env-vars='SESSION_ID=2026-02-07,GCS_SOURCE_PREFIX=gs://legend-lore-audio/1/sessions/2026-02-07/source/'
```

**Watch execution logs:**

```bash
# Get the execution name from the output above, then:
gcloud run jobs executions logs EXECUTION_NAME --region=us-central1
```

---

### Option 2 — Local

**Prerequisites:** Node.js 22+, ffmpeg (`brew install ffmpeg`), gcloud CLI

```bash
git clone https://github.com/nookworth/legend-lore.git
cd legend-lore
npm install
```

Authenticate with the judge service account (same key as above):

```bash
curl -o judge-key.json https://storage.googleapis.com/legend-lore-assets/judge-key.json
```

Create `.env`:

```bash
cp .env.example .env
```

Fill in `.env`:

```
GEMINI_API_KEY=             # your own key — https://aistudio.google.com/apikey
GOOGLE_CLOUD_PROJECT=legend-lore
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=./judge-key.json
GCS_BUCKET_AUDIO=legend-lore-audio
GCS_BUCKET_VIDEOS=legend-lore-video
GCS_BUCKET_ASSETS=legend-lore-assets
GROUP_ID=1
DISCORD_WEBHOOK_URL=        # optional — omit to use --skip-deliver
```

**Run from transcript** (skips transcription):

```bash
# Transcripts are committed to the repo — pipeline detects and uses them automatically
npm run pipeline -- --session data/sessions/2026-02-07 --skip-deliver
```

**Run from raw audio** (full pipeline):

```bash
# Download raw audio tracks first
mkdir -p data/sessions/2026-02-07/audio
gsutil cp "gs://legend-lore-audio/1/sessions/2026-02-07/source/*" \
  data/sessions/2026-02-07/audio/

# Run (add your AssemblyAI key to .env)
npm run pipeline -- --session data/sessions/2026-02-07 --skip-deliver
```

Additional key for transcription: `ASSEMBLYAI_API_KEY` from [assemblyai.com](https://www.assemblyai.com).

---

## Deployment

`deploy.sh` is a single-shot IaC script that provisions all GCP infrastructure
(Artifact Registry, service account, IAM roles, Secret Manager secrets, Cloud Run Job)
and deploys the containerized pipeline.

```bash
./deploy.sh
```

See [Dockerfile](./Dockerfile) and [scripts/cloud-run-job.ts](./scripts/cloud-run-job.ts)
for the container entrypoint.
