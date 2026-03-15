#!/usr/bin/env bash
# deploy.sh — Build and deploy the Legend Lore pipeline as a Cloud Run Job.
# Run once to set up infrastructure; re-run to push new image versions.
#
# Prerequisites:
#   - gcloud CLI authenticated: gcloud auth login
#   - Docker running
#   - .env file with API keys (GEMINI_API_KEY, ASSEMBLYAI_API_KEY, etc.)
#
# Usage:
#   ./deploy.sh
#
# To run a session after deploying:
#   gcloud run jobs execute legend-lore-pipeline --region=us-central1 \
#     --update-env-vars='SESSION_ID=2026-02-07,GCS_UTTERANCES_URI=gs://YOUR_BUCKET/...'

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
AR_REPO="legend-lore"
IMAGE_NAME="pipeline"
IMAGE_TAG="${IMAGE_TAG:-latest}"
JOB_NAME="legend-lore-pipeline"
SA_NAME="legend-lore-runner"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: set GOOGLE_CLOUD_PROJECT or run 'gcloud config set project <id>'"
  exit 1
fi

IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/$IMAGE_NAME:$IMAGE_TAG"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Legend Lore — Cloud Run Job Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Project: $PROJECT_ID"
echo "  Region:  $REGION"
echo "  Image:   $IMAGE"
echo "  Job:     $JOB_NAME"
echo ""

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  echo "Loading .env..."
  set -a; source .env; set +a
fi

# ── Enable APIs ───────────────────────────────────────────────────────────────
echo "Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  texttospeech.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet

# ── Artifact Registry ─────────────────────────────────────────────────────────
echo "Creating Artifact Registry repository (if not exists)..."
gcloud artifacts repositories describe "$AR_REPO" \
  --location="$REGION" --project="$PROJECT_ID" &>/dev/null \
  || gcloud artifacts repositories create "$AR_REPO" \
       --repository-format=docker \
       --location="$REGION" \
       --project="$PROJECT_ID" \
       --quiet

# ── Service Account ───────────────────────────────────────────────────────────
SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"
echo "Creating service account (if not exists)..."
gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null \
  || gcloud iam service-accounts create "$SA_NAME" \
       --display-name="Legend Lore Pipeline Runner" \
       --project="$PROJECT_ID"

echo "Granting IAM roles to service account..."
for ROLE in \
  roles/storage.admin \
  roles/cloudtexttospeech.user \
  roles/aiplatform.user \
  roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" \
    --quiet
done

# ── Secrets ───────────────────────────────────────────────────────────────────
echo "Creating secrets in Secret Manager (if not exist)..."

create_secret() {
  local name=$1
  local value="${2:-}"
  if [ -z "$value" ]; then
    echo "  Skipping $name (not set in environment)"
    return
  fi
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo "  $name already exists"
  else
    printf '%s' "$value" | gcloud secrets create "$name" \
      --data-file=- --project="$PROJECT_ID" --quiet
    echo "  Created $name"
  fi
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" --quiet
}

create_secret "GEMINI_API_KEY"       "${GEMINI_API_KEY:-}"
create_secret "ASSEMBLYAI_API_KEY"   "${ASSEMBLYAI_API_KEY:-}"
create_secret "REPLICATE_API_TOKEN"  "${REPLICATE_API_TOKEN:-}"
create_secret "DISCORD_WEBHOOK_URL"  "${DISCORD_WEBHOOK_URL:-}"

# ── Build & Push ──────────────────────────────────────────────────────────────
echo "Configuring Docker authentication..."
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

echo "Building Docker image..."
docker build -t "$IMAGE" .

echo "Pushing image to Artifact Registry..."
docker push "$IMAGE"

# ── Create / Update Cloud Run Job ─────────────────────────────────────────────
ENV_VARS="\
GCS_BUCKET_AUDIO=${GCS_BUCKET_AUDIO:-},\
GCS_BUCKET_VIDEOS=${GCS_BUCKET_VIDEOS:-},\
GCS_BUCKET_ASSETS=${GCS_BUCKET_ASSETS:-},\
GROUP_ID=${GROUP_ID:-default},\
GOOGLE_CLOUD_PROJECT=$PROJECT_ID,\
GOOGLE_CLOUD_LOCATION=$REGION"

SECRETS="\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest,\
REPLICATE_API_TOKEN=REPLICATE_API_TOKEN:latest,\
DISCORD_WEBHOOK_URL=DISCORD_WEBHOOK_URL:latest"

JOB_ARGS=(
  --image="$IMAGE"
  --region="$REGION"
  --project="$PROJECT_ID"
  --service-account="$SA_EMAIL"
  --set-env-vars="$ENV_VARS"
  --set-secrets="$SECRETS"
  --memory=4Gi
  --cpu=2
  --task-timeout=3600   # 1 hour — covers full transcription + video generation
  --max-retries=0
)

echo "Deploying Cloud Run Job..."
if gcloud run jobs describe "$JOB_NAME" --region="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  gcloud run jobs update "$JOB_NAME" "${JOB_ARGS[@]}"
else
  gcloud run jobs create "$JOB_NAME" "${JOB_ARGS[@]}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploy complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To run the pipeline from an existing transcript:"
echo ""
echo "  gcloud run jobs execute $JOB_NAME \\"
echo "    --region=$REGION \\"
echo "    --project=$PROJECT_ID \\"
echo "    --update-env-vars='SESSION_ID=<session-id>,GCS_UTTERANCES_URI=gs://<bucket>/<path>/utterances.json'"
echo ""
echo "To run the full pipeline from raw audio:"
echo ""
echo "  # First, upload your audio tracks:"
echo "  gsutil cp data/sessions/<session-id>/audio/*.aac gs://\$GCS_BUCKET_AUDIO/\$GROUP_ID/sessions/<session-id>/source/"
echo ""
echo "  gcloud run jobs execute $JOB_NAME \\"
echo "    --region=$REGION \\"
echo "    --project=$PROJECT_ID \\"
echo "    --update-env-vars='SESSION_ID=<session-id>,GCS_SOURCE_PREFIX=gs://<bucket>/<group>/sessions/<session-id>/source/'"
