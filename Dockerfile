FROM node:22-slim

# ffmpeg is required for audio merge and video stitching steps
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (includes tsx in devDependencies)
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# Campaign data (character context) — committed via .gitignore exception
COPY data/campaign.json ./data/campaign.json
COPY data/player_map.json ./data/player_map.json

CMD ["node_modules/.bin/tsx", "scripts/cloud-run-job.ts"]
