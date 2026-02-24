import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, requireConfig } from '../shared/config.js';

export async function deliver(videoPath: string): Promise<void> {
  requireConfig(['discordWebhookUrl']);

  console.log('[deliver] Posting recap to Discord...');

  const videoBuffer = await readFile(videoPath);
  const fileName = path.basename(videoPath);

  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      content: '🎲 **Session Recap is ready!** Here are the highlights from tonight\'s adventure.',
    }),
  );
  form.append('file', new Blob([videoBuffer], { type: 'video/mp4' }), fileName);

  const response = await fetch(config.discordWebhookUrl, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }

  console.log('[deliver] Recap posted to Discord ✓');
}
