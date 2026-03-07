import { config, requireConfig } from '../shared/config.js';

export async function deliver(videoUrl: string): Promise<void> {
  requireConfig(['discordWebhookUrl']);

  console.log('[deliver] Posting recap to Discord...');

  const response = await fetch(config.discordWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `🎲 **Session Recap is ready!** Here are the highlights from tonight's adventure.\n${videoUrl}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }

  console.log('[deliver] Recap posted to Discord ✓');
}
