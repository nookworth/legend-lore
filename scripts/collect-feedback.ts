#!/usr/bin/env tsx
import 'dotenv/config';
import { config } from '../src/shared/config.js';
import { findLatestRecap } from '../src/feedback/find-recap.js';
import { fetchMessagesAfter, filterReplies } from '../src/feedback/collect-replies.js';
import { distillReplies, renderCandidates } from '../src/feedback/distill.js';
import {
  readPreferences,
  writePreferences,
  splitPreferences,
  appendCandidates,
} from '../src/feedback/preferences.js';

async function main(): Promise<void> {
  if (!config.discordBotToken) {
    console.log('[collect-feedback] DISCORD_BOT_TOKEN not set — skipping');
    process.exit(0);
  }

  const found = await findLatestRecap();
  if (!found) {
    console.log('[collect-feedback] No session with a recap found — skipping');
    process.exit(0);
  }

  console.log(
    `[collect-feedback] Found recap for session ${found.sessionId} (message ${found.recap.messageId})`,
  );

  const postedAt = Date.parse(found.recap.postedAt);
  if (isNaN(postedAt)) {
    console.log('[collect-feedback] Invalid postedAt timestamp — skipping');
    process.exit(0);
  }

  const messages = await fetchMessagesAfter(found.recap.channelId, postedAt);
  if (messages.length === 0) {
    console.log('[collect-feedback] No messages found after recap — skipping');
    process.exit(0);
  }

  const replies = filterReplies(messages, found.recap.messageId);
  if (replies.length === 0) {
    console.log('[collect-feedback] No replies to the recap found — skipping');
    process.exit(0);
  }

  console.log(`[collect-feedback] Found ${replies.length} reply/replies`);

  const existingMd = await readPreferences();
  const existingCurated = splitPreferences(existingMd).curated;

  const items = await distillReplies(replies, existingCurated);
  if (items.length === 0) {
    console.log('[collect-feedback] No actionable guidance extracted — skipping');
    process.exit(0);
  }

  const candidatesMd = renderCandidates(items);
  const updated = appendCandidates(existingMd, candidatesMd);
  await writePreferences(updated);

  console.log('[collect-feedback] Appended candidates to data/preferences.md ✓');
}

main().catch((err) => {
  console.error('[collect-feedback] Error:', (err as Error).message);
  process.exit(0);
});
