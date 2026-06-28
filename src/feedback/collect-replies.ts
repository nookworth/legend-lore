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
      page = (await discordGet(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100&after=${afterSnowflake}`,
      )) as DiscordMessage[];
    } catch {
      return messages;
    }

    if (page.length === 0) break;

    // Page is oldest-first with ?after= parameter — oldest is first
    const oldest = page[0]!;
    const oldestTs = Date.parse(oldest.timestamp);

    messages.push(...page);

    if (page.length < 100) break;
    afterSnowflake = page[page.length - 1]!.id;
  }

  return messages;
}
