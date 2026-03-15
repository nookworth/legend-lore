# Legend Lore

Automated D&D session recap generator. Feeds raw session audio through a 10-step pipeline to produce a narrated, illustrated video recap delivered to Discord.

**Hackathon category**: Creative Storyteller — uses Gemini 2.0 Flash with interleaved `TEXT` + `IMAGE` output modalities to generate narration and illustrated title cards simultaneously.

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
| 10 | Deliver to Discord webhook |

---

## Prerequisites

- Node.js 22+
- ffmpeg (`brew install ffmpeg` on macOS)
- A Google Cloud project with billing enabled
- A GCP service account with the following roles:
  - `roles/storage.admin`
  - `roles/cloudtexttospeech.user`
  - `roles/aiplatform.user`

---

## Setup

```bash
git clone https://github.com/nookworth/legend-lore.git
cd legend-lore
npm install
```

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required keys:

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `GOOGLE_CLOUD_PROJECT` | Your GCP project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to your service account JSON |
| `GCS_BUCKET_AUDIO` | GCS bucket for audio storage |
| `GCS_BUCKET_VIDEOS` | GCS bucket for video output |
| `GCS_BUCKET_ASSETS` | GCS bucket for portraits/assets |
| `GROUP_ID` | Arbitrary namespace for your group (e.g. `1`) |

Optional:

| Variable | Description |
|----------|-------------|
| `ASSEMBLYAI_API_KEY` | Required only for steps 1–3 (transcription) |
| `DISCORD_WEBHOOK_URL` | Required for step 10; omit with `--skip-deliver` |

Create your GCS buckets:

```bash
gsutil mb -l us-central1 gs://YOUR_AUDIO_BUCKET
gsutil mb -l us-central1 gs://YOUR_VIDEO_BUCKET
gsutil mb -l us-central1 gs://YOUR_ASSETS_BUCKET
```

---

## Running the pipeline

### Option A — From provided transcript (recommended)

A session transcript is committed to the repo. The pipeline detects `utterances.json`
in the session directory and automatically skips steps 1–3.

```bash
npm run pipeline -- --session data/sessions/2026-02-07
```

Required API keys: `GEMINI_API_KEY` + GCS credentials + Cloud TTS (via service account).
No AssemblyAI key needed.

Add `--skip-deliver` to skip Discord delivery and just produce the local video file:

```bash
npm run pipeline -- --session data/sessions/2026-02-07 --skip-deliver
```

### Option B — From raw audio (full pipeline)

The raw per-user audio tracks are available in GCS:

```
gs://legend-lore-audio/1/sessions/2026-02-07/source/
```

Download them locally, then run:

```bash
# Download audio tracks
mkdir -p data/sessions/2026-02-07/audio
gsutil cp "gs://legend-lore-audio/1/sessions/2026-02-07/source/*" \
  data/sessions/2026-02-07/audio/

# Run full pipeline (includes merge, upload, and transcription)
npm run pipeline -- --session data/sessions/2026-02-07 --skip-deliver
```

Additional required key: `ASSEMBLYAI_API_KEY`.

---

## Cloud Run deployment

`deploy.sh` is a single-shot infrastructure-as-code script that:

1. Enables required GCP APIs
2. Creates an Artifact Registry repository
3. Creates a service account with appropriate IAM roles
4. Stores API keys in Secret Manager
5. Builds and pushes the Docker image
6. Creates the Cloud Run Job

```bash
./deploy.sh
```

After deploying, run a session:

```bash
# From transcript (skip transcription)
gcloud run jobs execute legend-lore-pipeline \
  --region=us-central1 \
  --update-env-vars='SESSION_ID=2026-02-07,GCS_UTTERANCES_URI=gs://legend-lore-audio/1/sessions/2026-02-07/utterances.json'

# From raw audio (full pipeline)
gcloud run jobs execute legend-lore-pipeline \
  --region=us-central1 \
  --update-env-vars='SESSION_ID=2026-02-07,GCS_SOURCE_PREFIX=gs://legend-lore-audio/1/sessions/2026-02-07/source/'
```
