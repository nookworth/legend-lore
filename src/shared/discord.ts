import { config } from './config.js';

const DISCORD_EPOCH = 1420070400000n;

export function tsToSnowflake(epochMs: number): string {
  return ((BigInt(epochMs) - DISCORD_EPOCH) << 22n).toString();
}

export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
}

export interface DiscordPostResult {
  id: string;
  channelId: string;
}

interface DiscordMessageResponse {
  id: string;
  channel_id: string;
}

export async function discordGet(url: string): Promise<unknown> {
  let delay = 0;
  for (;;) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${config.discordBotToken}` },
    });
    if (res.status === 429) {
      const body = (await res.json()) as { retry_after?: number };
      delay = Math.ceil((body.retry_after ?? 1) * 1000);
      continue;
    }
    if (!res.ok) {
      const err = new Error(`Discord API ${res.status}: ${url}`);
      (err as NodeJS.ErrnoException).code = String(res.status);
      throw err;
    }
    return res.json();
  }
}

export async function discordPost(
  url: string,
  body: unknown,
): Promise<unknown> {
  let delay = 0;
  for (;;) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.discordBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const body = (await res.json()) as { retry_after?: number };
      delay = Math.ceil((body.retry_after ?? 1) * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord API ${res.status}: ${text}`);
    }
    return res.json();
  }
}

export async function botPostMessage(
  channelId: string,
  content: string,
): Promise<DiscordPostResult> {
  const res = await discordPost(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    { content },
  );
  const msg = res as DiscordMessageResponse;
  return { id: msg.id, channelId: msg.channel_id };
}
