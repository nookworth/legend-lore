# Hackathon Phase 1: Core AI Pipeline

## Context

Entering the Gemini Live Agent Challenge (deadline: March 16, 2026) in the "Creative Storyteller" category. This is the most important phase — it produces the core AI output that will be demoed.

**New repository required.** The hackathon specifies a new project. Create a fresh repo (e.g. `scrying-glass-hackathon/`). This plan document lives in the existing repo for reference only.

The output of this phase is a local MP4 "session recap" video:

```
[Intro narration] → [Clip 1] → [Bridge narration] → [Clip 2] → ... → [Outro narration]
```

- **Clips**: AI-generated video (Replicate LTX-Video by default, Veo behind a flag)
- **Narration**: Gemini-written text → Google Cloud TTS audio over an ffmpeg title card

Cloud Run deployment is Phase 2. Discord delivery is included in Phase 1 — it's the "live reveal" moment that makes the experience social and directly addresses the judging criterion.

---

## Hackathon Requirements Satisfied

- Leverage a Gemini model ✓ (moment selection + narrative generation)
- Google GenAI SDK ✓
- At least one Google Cloud service ✓ (Cloud SQL, GCS, Cloud TTS)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Database | Cloud SQL (PostgreSQL) |
| Storage | Google Cloud Storage |
| Transcription | AssemblyAI (multichannel — kept from existing work) |
| Moment selection + narrative | Gemini 2.0 Flash via Google GenAI SDK |
| Narration audio | Google Cloud TTS |
| Video generation | Replicate LTX-Video (default) / Veo (flag) |
| Video assembly | ffmpeg |

---

## Pipeline

The pipeline is a single sequential CLI script — no webhooks, no event chains.

```
Craig Bot per-user AAC tracks (local)
      ↓
scripts/run-pipeline.ts  --audio-dir ./session/
      ↓
1. merge-audio      — ffmpeg join filter → multichannel .m4a
2. upload-audio     — Upload to GCS (audio bucket)
3. transcribe       — AssemblyAI multichannel → poll for completion → parse utterances
4. select-moments   — Gemini: 3-5 ranked clip-worthy moments (structured output)
5. gen-narrative    — Gemini: intro + bridge + outro text (uses transcript + moments)
6. gen-tts          — Cloud TTS: narration text → .mp3 files
7. gen-video        — Replicate/Veo: one video per selected moment → poll
8. stitch           — ffmpeg: assemble clips + narration into final MP4
9. upload-output    — Upload final video to GCS (videos bucket)
10. deliver         — Post final video to Discord channel via webhook
      ↓
Output: final_recap.mp4 (local + GCS + Discord)
```

Session state is persisted to Cloud SQL at each step (pending → transcribing → selecting → generating → complete | failed).

---

## Project Structure

```
scrying-glass-hackathon/
├── src/
│   ├── pipeline/
│   │   ├── index.ts              # Orchestrator — runs steps 1-9 in sequence
│   │   ├── merge-audio.ts        # ffmpeg join filter
│   │   ├── transcribe.ts         # AssemblyAI submit + poll + parse utterances
│   │   ├── select-moments.ts     # Gemini moment selection
│   │   ├── generate-narrative.ts # Gemini intro/bridge/outro text
│   │   ├── generate-tts.ts       # Cloud TTS → .mp3 files
│   │   ├── generate-video.ts     # Routes to Replicate or Veo provider
│   │   ├── stitch-video.ts       # ffmpeg final assembly
│   │   └── deliver.ts            # Discord webhook post
│   ├── providers/
│   │   └── video/
│   │       ├── interface.ts      # VideoProvider interface
│   │       ├── replicate.ts      # Replicate LTX-Video implementation
│   │       └── veo.ts            # Veo implementation (Vertex AI)
│   └── shared/
│       ├── types.ts              # Session, Clip, MomentCandidate, Utterance, etc.
│       ├── config.ts             # Env var loading + validation
│       ├── database.ts           # Cloud SQL client (pg + cloud-sql-connector)
│       └── storage.ts            # GCS client
├── scripts/
│   └── run-pipeline.ts           # CLI entry point
├── data/                         # gitignored — local test data
│   └── audio/
├── Dockerfile                    # Node + ffmpeg (for Phase 2 Cloud Run)
├── package.json
└── README.md
```

---

## GCP Setup

Before writing code:

1. Create GCP project
2. Enable APIs: Cloud SQL Admin, Cloud Storage, Cloud Text-to-Speech, Vertex AI (if using Veo)
3. Create Cloud SQL instance (PostgreSQL 15), run schema migration (see below)
4. Create GCS buckets: `audio`, `videos` (videos bucket: public read)
5. Create service account with roles: Cloud SQL Client, Storage Object Admin, Cloud TTS User
6. Download service account JSON for local dev (`GOOGLE_APPLICATION_CREDENTIALS`)

---

## Database Schema

Port directly from `supabase/migrations/20260131000001_initial_schema.sql`. Same 3 tables:

- **sessions**: id, status, audio_url, transcript_url, transcript_text, metadata (JSONB), error_message, created_at, updated_at
- **clips**: id, session_id, start_time, end_time, summary, transcript_excerpt, video_prompt, video_url, selected, metadata
- **votes**: id, clip_id, discord_user_id (unused in MVP)

---

## Step-by-Step Implementation

### Step 1: Audio Merge

Port exactly from the validated ffmpeg approach. Inputs sorted alphabetically by username — deterministic channel-to-speaker mapping stored in `session.metadata.channel_map`.

```bash
ffmpeg -i user_a.aac -i user_b.aac -i user_c.aac \
  -filter_complex "join=inputs=3:channel_layout=3c" \
  -c:a aac output_multichannel.m4a
```

Reference: `data/` directory in existing repo for test audio.

---

### Step 2: Upload to GCS

Upload merged .m4a to GCS audio bucket. Store signed URL in `session.audio_url`.

---

### Step 3: Transcription

Submit multichannel audio to AssemblyAI. Poll for completion (no webhook needed for CLI pipeline).

**Parse utterances** into the same compact format used in the existing iteration:
```typescript
interface Utterance {
  speaker: string;   // mapped from channel number via channel_map
  text: string;
  start: number;     // milliseconds
  end: number;       // milliseconds
}
```

Store full transcript text (`session.transcript_text`) and upload raw AssemblyAI response to GCS (`session.transcript_url`).

Reference: `data/transcripts/` in existing repo for example parsed utterance format.
Reference: `data/curl/moment_selection.sh` for the exact input format Gemini expects.

---

### Step 4: Moment Selection (Gemini)

- **Model**: `gemini-2.0-flash`
- **SDK**: `@google/generative-ai`
- **Input**: Parsed utterances (NOT full AssemblyAI response) + character context from `campaign.json` (see note below)
- **Structured output** (JSON schema — same approach as existing `moment_selection.sh`):

```typescript
interface MomentCandidate {
  rank: number;
  start_time: number;       // milliseconds
  end_time: number;         // milliseconds
  summary: string;
  transcript_excerpt: string;
  category: 'combat' | 'roleplay' | 'comedy' | 'dramatic' | 'epic';
  reasoning: string;
}
```

Insert all candidates into `clips` table. Mark the top 3 ranked as `selected = true`. These 3 clips form the highlight reel in both auto-select and interactive (voting) modes.

Port the prompt from `data/curl/moment_selection.sh`.

> **`campaign.json` note**: A character sync script (`scripts/sync-characters.ts`) was planned in the original repo but never built. For the hackathon, hand-craft `campaign.json` manually — it's static data that rarely changes and takes ~20 minutes. The format is documented in the original repo's CLAUDE.md. Place it at `data/campaign.json` (gitignored). The sync script is a productization concern, not a hackathon concern.

---

### Step 5: Narrative Generation + Illustration (Gemini — interleaved output)

Second Gemini call. Uses Gemini's **native interleaved text+image output** to produce both the narration text and a matching illustration for each segment in a single response stream. This is the core demonstration of the interleaved output requirement.

- **Model**: `gemini-2.0-flash-exp` (experimental model with image generation support)
- **SDK**: `@google/generative-ai` with `responseModalities: ['TEXT', 'IMAGE']`
- **Input**:
  - Full transcript (`session.transcript_text`) — needed to accurately describe what happened *between* clips, not just at the clip moments
  - Selected moments (with timestamps, summaries, excerpts)
  - Character context from `campaign.json`
- **Output**: interleaved stream of text and image parts, parsed into:

```typescript
interface NarrativeSegment {
  text: string;       // Narration copy (passed to TTS)
  image: Buffer;      // Generated illustration (used as title card background)
}

interface Narrative {
  intro: NarrativeSegment;
  bridges: NarrativeSegment[];  // 2 bridges for 3 clips (between clip 1→2 and clip 2→3)
  outro: NarrativeSegment;
}
```

- **Tone**: Cinematic D&D narrator. Dragonlance setting. Keep each text segment short (~2-4 sentences).
- **Illustration style prompt**: Fantasy art, painterly, consistent with Dragonlance aesthetic — include this in the system prompt so images are stylistically coherent across segments.
- **Parse the response**: iterate the response parts; `text` parts accumulate into the narration copy, `inlineData` parts are the illustration for that segment.

---

### Step 6: Cloud TTS

Convert the text from each `NarrativeSegment` (intro, bridges[], outro) to an .mp3 file.

- Use `@google-cloud/text-to-speech`
- Voice: a deep, dramatic voice appropriate for fantasy narration (e.g. `en-US-Studio-Q` or similar — evaluate options)
- Output: `narration_intro.mp3`, `narration_bridge_0.mp3`, ..., `narration_outro.mp3`

---

### Step 7: Video Generation

Submit one video generation job per selected clip (3 clips). Poll for completion.

**Provider interface**:
```typescript
interface VideoProvider {
  generate(prompt: string, options: VideoOptions): Promise<string>; // returns video URL
}
```

`VIDEO_PROVIDER=replicate` (default) or `VIDEO_PROVIDER=veo`.

**Replicate (LTX-Video)**:
- ~$0.09/clip, ~5s video at 768x512
- Download immediately after generation — output URLs are temporary

**Veo (Vertex AI)**:
- Veo 3.1 Fast: ~$0.15/sec (~$1.20 for 8s clip), 1080p, native audio
- Access via Vertex AI SDK

Build Replicate first (already validated in concept). Add Veo behind the flag once Replicate works end-to-end.

---

### Step 8: Video Stitching (ffmpeg)

Assemble narration segments and video clips into a single MP4.

**Structure**:
```
narration_intro → clip_1 → narration_bridge_0 → clip_2 → narration_bridge_1 → ... → narration_outro
```

**Narration segments**: the Gemini-generated illustration is used as the background image; TTS audio (.mp3) plays over it; ffmpeg `drawtext` renders the narration text on top. Each title card is visually unique — a painted scene that matches what the narration describes.

Use ffmpeg concat filter or concat demuxer to join segments.

---

### Step 9: Upload Output

Upload `final_recap.mp4` to GCS videos bucket (public read). Store URL in `session.metadata.recap_url`.

---

### Step 10: Discord Delivery

Post the final video to the campaign's Discord channel via webhook. This is the "live reveal" moment — players waiting in Discord see the recap drop in real time.

- Download the video from GCS (or use the local file if still in memory)
- POST to `DISCORD_WEBHOOK_URL` with the video file as a multipart attachment
- Include a short message: e.g. `🎲 **Session Recap is ready!** Here are the highlights from tonight's adventure.`
- Discord file upload limit: 8MB. A stitched recap of 3-5 clips should comfortably fit.
- Update `session.status = 'complete'` after successful delivery.

---

## Environment Variables

```
GEMINI_API_KEY=
ASSEMBLYAI_API_KEY=
REPLICATE_API_TOKEN=
DISCORD_WEBHOOK_URL=          # Discord channel webhook for final delivery
CLOUD_SQL_CONNECTION_NAME=
GCS_BUCKET_AUDIO=
GCS_BUCKET_VIDEOS=
VIDEO_PROVIDER=replicate       # or "veo"
GOOGLE_APPLICATION_CREDENTIALS=  # service account JSON path (local dev)
```

---

## Verification

```bash
# Dry run — skips video generation, uses placeholder clips
node scripts/run-pipeline.ts --audio-dir ./data/audio/session-test/ --dry-run

# Full run
node scripts/run-pipeline.ts --audio-dir ./data/audio/session-test/
# Expected: final_recap.mp4 in ./output/ and uploaded to GCS
```

Per-step checks:
- **Transcription**: Verify channel attribution matches known speakers
- **Moment selection**: Read 3-5 moments — are they actually clip-worthy?
- **Narrative**: Read intro/bridges/outro — are they accurate to what happened in the session?
- **TTS**: Listen to narration audio — is the voice/tone right?
- **Video clips**: Watch individual clips before stitching
- **Final output**: Watch complete recap — does the narrative flow feel cohesive?

---

## Stretch Goal: Collaborative Voting UI

If the core pipeline is complete with time to spare, add a minimal web UI for collaborative moment selection. This directly addresses the "live and context-aware" judging criterion by making the selection step a real-time social experience.

**Flow:**
1. After step 4 (moment selection), pipeline pauses and posts the shareable link to Discord: `🎲 Your moments are ready! Vote here: https://<url>`
2. Players open the link — moment cards (with Gemini-generated illustrations) are displayed
3. Each player selects their top 3 moments; votes update in real time as players choose
4. Once all players have voted (or a timer expires), the pipeline resumes with the top-voted moments
5. Steps 5-10 run as normal

**Implementation notes:**
- Single-page app (no framework required — vanilla HTML/JS or minimal React)
- Server-Sent Events (SSE) for real-time vote updates
- No auth required for hackathon demo — shareable URL is the only gate
- Pipeline orchestrator polls Cloud SQL for selection confirmation before continuing
- Design a clean seam in `pipeline/index.ts`: after `select-moments`, check for `--interactive` flag. If set, pause and wait for DB signal. If not set, auto-select top-ranked moment and continue. This makes the voting UI additive, not a rewrite.

**Do not build this unless steps 1-10 are working end-to-end.**

---

## Cost Per Run

Costs scale roughly linearly with session duration. Estimates below are for a 90-minute session (typical) and a 4-hour session (long).

| Step | 90 min | 4 hrs |
|---|---|---|
| AssemblyAI multichannel | ~$1.00+ | ~$2.50–3.00 |
| Gemini 2.0 Flash (2 calls) | ~$0.02 | ~$0.02 |
| Cloud TTS (~500 words) | ~$0.006 | ~$0.006 |
| Replicate LTX-Video (3 clips) | ~$0.27 | ~$0.27 |
| Cloud SQL + GCS | ~$0.01 | ~$0.01 |
| **Total (Replicate)** | **~$1.30** | **~$2.80–3.30** |
| Veo 3.1 Fast instead (3 × 8s) | +~$3.60 | +~$3.60 |

> **Note**: The original $1.48/4hr AssemblyAI estimate was based on simple per-minute rates and understated actual costs. Real-world usage (~$1+ for 90 min) suggests features like multichannel diarization and word boost add meaningful overhead. AssemblyAI is the dominant cost driver — see productization notes below for alternatives.

### Transcription Alternatives (for productized version)

| Option | 90 min | 4 hrs | Trade-off |
|---|---|---|---|
| AssemblyAI (current) | ~$1.00+ | ~$2.50–3.00 | Best accuracy, multichannel diarization |
| Gemini native audio | ~$0.10 | ~$0.25 | 10x cheaper; loses channel-based attribution |
| Whisper on Modal (self-hosted) | ~$0.08 | ~$0.29 | Cheapest; no diarization needed if Craig Bot tracks available |

Whisper on Modal is the strongest long-term bet for the productized version — particularly because with per-user Craig Bot tracks, speaker attribution is already solved at the recording layer (no diarization needed). Each channel is transcribed separately then merged by timestamp.
