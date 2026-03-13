import 'node:process';

export const config = {
  geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
  assemblyAiApiKey: process.env['ASSEMBLYAI_API_KEY'] ?? '',
  replicateApiToken: process.env['REPLICATE_API_TOKEN'] ?? '',
  discordWebhookUrl: process.env['DISCORD_WEBHOOK_URL'] ?? '',
  cloudSqlConnectionName: process.env['CLOUD_SQL_CONNECTION_NAME'] ?? '',
  gcsBucketAudio: process.env['GCS_BUCKET_AUDIO'] ?? '',
  gcsBucketVideos: process.env['GCS_BUCKET_VIDEOS'] ?? '',
  gcsBucketAssets: process.env['GCS_BUCKET_ASSETS'] ?? '',
  groupId: process.env['GROUP_ID'] ?? 'default',
  videoProvider: (process.env['VIDEO_PROVIDER'] ?? 'replicate') as 'replicate' | 'veo',
  googleApplicationCredentials: process.env['GOOGLE_APPLICATION_CREDENTIALS'] ?? '',
  gcpProject: process.env['GOOGLE_CLOUD_PROJECT'] ?? '',
  gcpLocation: process.env['GOOGLE_CLOUD_LOCATION'] ?? 'us-central1',
};

export function requireConfig(keys: (keyof typeof config)[]): void {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
