# Hackathon Phase 2: Automated Infrastructure

> Skeletal plan — detail to be filled in after Phase 1 is complete.

## Goal

Move from a manually-triggered CLI script to a deployed, automated pipeline on GCP.

---

## Key Steps

- **Dockerize + deploy to Cloud Run Job** — package the Phase 1 pipeline into a container, deploy as a Cloud Run Job triggered via `gcloud run jobs execute`
- **Automated trigger** — some mechanism to kick off the pipeline without running a local CLI command (options: Cloud Scheduler, a simple HTTP endpoint on Cloud Run, or a Storage trigger when audio is uploaded)
- **Error handling + retry** — retry script for failed sessions; structured error logging to Cloud SQL
- **Secrets management** — move env vars from local `.env` to Google Secret Manager

---

## Productization Notes

### Self-hosting Craig Bot
Craig Bot is open source and could be forked, branded, and bundled as the Scrying Glass recorder. Users add the bot to their Discord server — it records per-user AAC tracks and uploads them directly to GCS when the session ends, triggering the pipeline automatically. This:
- Eliminates manual audio upload entirely
- Enforces per-user track separation at the source (clean speaker attribution guaranteed)
- Creates a moat: the recording layer is controlled by the product, not the user
- Mirrors how SessionKeeper (main competitor) operates

Target user flow:
```
DM: /record start → session plays → DM: /record stop
→ pipeline triggers → recap video drops in Discord
```

### Session Length Gating
Transcription cost scales linearly with session duration and is the dominant cost driver. For a subscription model, cap session length per tier to protect margins:
- Base plan: up to 2 hours per session
- Pro plan: up to 4 hours per session
- Hard cap at 4 hours regardless of plan

Check duration before submission using `ffprobe` and reject files that exceed the plan limit. This also protects against accidental runaway costs from malformed uploads.

### Transcription Cost Reduction
For the productized version, replace AssemblyAI with Whisper on Modal. With per-user Craig Bot tracks, speaker attribution is solved at the recording layer — no diarization needed. Each track is transcribed separately by Whisper and merged by timestamp. Cost drops from ~$1+ to ~$0.08 per 90-minute session.

## Open Questions (to resolve when building)

- What triggers the pipeline in practice? Manual `gcloud` command vs. HTTP endpoint vs. Storage event?
- Should the Cloud Run Job run the full pipeline in one container (simplest), or split into stages?
- How to handle AssemblyAI and Replicate polling timeouts within Cloud Run Job time limits?
