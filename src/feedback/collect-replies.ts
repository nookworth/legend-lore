import { discordGet, tsToSnowflake } from '../shared/discord.js';
import type { DiscordMessage } from '../shared/discord.js';

export interface Reply {
  author: string;
  text: string;
}

export function filterReplies(
  messages: DiscordMessage[],
  recapMessageId: string,
): Reply[] {
  return messages
    .filter(
      (m) =>
        !m.author.bot &&
        m.message_reference?.message_id === recapMessageId &&
        m.content.trim().length > 0,
    )
    .map((m) => ({
      author: m.author.username,
      text: m.content.trim(),
    }));
}

export async function fetchMessagesAfter(
  channelId: string,
  afterMs: number,
): Promise<DiscordMessage[]> {
  const messages: DiscordMessage[] = [];
  let afterSnowflake = tsToSnowflake(afterMs);

  for (;;) {
    let page: DiscordMessage[];
    try {
      // Discord returns messages in ascending (oldest-first) order when using
      // the `after` parameter — the opposite of `before` pagination.
      page = (await discordGet(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100&after=${afterSnowflake}`,
      )) as DiscordMessage[];
    } catch (err) {
      console.log(`[collect-feedback] Failed to fetch messages from channel ${channelId}: ${(err as Error).message}`);
      return messages;
    }

    if (page.length === 0) break;

    messages.push(...page);

    // Advance cursor to the newest message on this page; stop when we get a
    // partial page (no more messages available).
    if (page.length < 100) break;
    afterSnowflake = page[page.length - 1]!.id;
  }

  return messages;
}
