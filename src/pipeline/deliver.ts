import path from 'node:path';
import { config, requireConfig } from '../shared/config.js';
import { botPostMessage } from '../shared/discord.js';
import { writeRecapRecord } from './recap-record.js';

export async function deliver(
  videoUrl: string,
  opts: { sessionId: string; runId: string },
): Promise<void> {
  requireConfig(['discordBotToken', 'discordRecapChannelId']);

  console.log('[deliver] Posting recap to Discord...');

  const content = `🎲 **Session Recap is ready!** Here are the highlights from tonight's adventure.\n${videoUrl}`;
  const result = await botPostMessage(config.discordRecapChannelId, content);

  const sessionDir = path.join('data', 'sessions', opts.sessionId);
  await writeRecapRecord(sessionDir, opts.sessionId, {
    runId: opts.runId,
    messageId: result.id,
    channelId: result.channelId,
    postedAt: new Date().toISOString(),
  });

  console.log(`[deliver] Recap posted to Discord ✓ (message ${result.id})`);
}
