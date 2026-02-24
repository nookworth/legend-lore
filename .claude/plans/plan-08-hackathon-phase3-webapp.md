# Phase 3: Web App Integration

> Skeletal plan — post-hackathon. Do not build until Phase 1 and 2 are complete and the core product is validated.

## Goal

Add a user-facing web app so groups can manage sessions, browse clips, and vote on favorites — turning Scrying Glass into a productized service.

---

## Key Ideas

- **Firebase** as the web layer — Firebase Auth for user accounts, Firebase Hosting for the frontend, with the GCP backend from Phase 2 unchanged underneath
- **Session dashboard** — upload audio, track pipeline status, view past recaps
- **Clip voting** — players vote on which moments were most memorable (the `votes` table is already in the schema)
- **Multi-campaign support** — each group/campaign gets its own space, character roster, and session history
- **Character sync** — UI for linking D&D Beyond characters to a campaign (syncs the compact profile used in LLM prompts)

---

## Open Questions (to resolve when building)

- Firebase or raw GCP (Identity Platform + Cloud Run frontend)? Firebase is faster to build with.
- Multi-tenancy model — per-campaign GCS buckets or shared bucket with path prefixes?
- Pricing model for productized version — per session, subscription, or freemium?
