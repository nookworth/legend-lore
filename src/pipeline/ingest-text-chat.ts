import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Utterance } from '../shared/types.js';
import { config } from '../shared/config.js';
import { discordGet, tsToSnowflake } from '../shared/discord.js';
import type { DiscordMessage } from '../shared/discord.js';

const POST_SESSION_BUFFER_MS = 10 * 60 * 1000;

// Channel types the bot should scrape (Discord API type values)
const TEXT_CHANNEL_TYPES = new Set([
  0,  // GUILD_TEXT
  2,  // GUILD_VOICE (has built-in text chat)
  5,  // GUILD_ANNOUNCEMENT
  15, // GUILD_FORUM
  16, // GUILD_MEDIA
]);

interface RecordingInfo {
  startTime: Date;
  channelId?: string;
  guildId?: string;
}

export async function parseRecordingInfo(audioDir: string): Promise<RecordingInfo | null> {
  try {
    const raw = await readFile(path.join(audioDir, 'info.txt'), 'utf-8');
    const startMatch = raw.match(/Start time:\s*(\S+)/);
    if (!startMatch?.[1]) return null;
    const startTime = new Date(startMatch[1]);
    if (isNaN(startTime.getTime())) return null;

    const info: RecordingInfo = { startTime };
    const channelMatch = raw.match(/Channel:\s*.+?\((\d+)\)/);
    if (channelMatch?.[1]) info.channelId = channelMatch[1];
    const guildMatch = raw.match(/Guild:\s*.+?\((\d+)\)/);
    if (guildMatch?.[1]) info.guildId = guildMatch[1];
    return info;
  } catch {
    return null;
  }
}

export async function listGuildTextChannels(guildId: string): Promise<string[]> {
  const ids: string[] = [];
  try {
    const channels = (await discordGet(
      `https://discord.com/api/v10/guilds/${guildId}/channels`,
    )) as Array<{ id: string; type: number }>;
    for (const ch of channels) {
      if (TEXT_CHANNEL_TYPES.has(ch.type)) ids.push(ch.id);
    }
  } catch (err) {
    console.log(`[text-chat] Could not list guild channels: ${(err as Error).message}`);
  }

  try {
    const threads = (await discordGet(
      `https://discord.com/api/v10/guilds/${guildId}/threads/active`,
    )) as { threads: Array<{ id: string }> };
    for (const t of threads.threads) ids.push(t.id);
  } catch (err) {
    console.log(`[text-chat] Could not list active threads: ${(err as Error).message}`);
  }

  return ids;
}

export async function fetchChannelMessages(
  channelId: string,
  afterMs: number,
  beforeMs: number,
): Promise<DiscordMessage[]> {
  const messages: DiscordMessage[] = [];
  let beforeSnowflake = tsToSnowflake(beforeMs);

  for (;;) {
    let page: DiscordMessage[];
    try {
      page = (await discordGet(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100&before=${beforeSnowflake}`,
      )) as DiscordMessage[];
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === '403' || code === '404') {
        // Bot lacks access to this channel — silently skip
      } else {
        console.log(`[text-chat] Channel ${channelId} fetch error: ${(err as Error).message}`);
      }
      break;
    }

    if (page.length === 0) break;

    // Page is newest-first; oldest is last
    const oldest = page[page.length - 1];
    if (!oldest) break;
    const oldestTs = Date.parse(oldest.timestamp);

    // Keep only messages within the window
    const inWindow = page.filter((m) => Date.parse(m.timestamp) >= afterMs);
    messages.push(...inWindow);

    if (oldestTs < afterMs) break; // crossed the window start — done
    beforeSnowflake = oldest.id;
  }

  return messages;
}

export function messagesToUtterances(
  messages: DiscordMessage[],
  recordingStartMs: number,
  playerMap: Record<string, string>,
): { utterances: Utterance[]; handles: string[] } {
  const knownHandles = new Set(Object.keys(playerMap).map((h) => h.toLowerCase()));
  const seenHandles = new Set<string>();
  const utterances: Utterance[] = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;
    if (!msg.content.trim()) continue;
    if (msg.content.startsWith('!') || msg.content.startsWith('/')) continue;

    const handle = msg.author.username.toLowerCase();
    if (!knownHandles.has(handle)) continue;

    const start = Date.parse(msg.timestamp) - recordingStartMs;
    if (start < 0) continue;

    utterances.push({ speaker: handle, text: msg.content.trim(), start });
    seenHandles.add(handle);
  }

  return { utterances, handles: [...seenHandles] };
}

export async function ingestTextChat(opts: {
  audioDir: string;
  playerMap: Record<string, string>;
  utterances: Utterance[];
  channelIds: string[];
}): Promise<{ utterances: Utterance[]; handles: string[] }> {
  const empty = { utterances: [] as Utterance[], handles: [] as string[] };

  if (!config.discordBotToken) {
    console.log('[text-chat] DISCORD_BOT_TOKEN not set — skipping text chat ingestion');
    return empty;
  }

  const info = await parseRecordingInfo(opts.audioDir);
  if (!info) {
    console.log('[text-chat] audio/info.txt missing or unparseable — skipping text chat ingestion');
    return empty;
  }

  const recordingStartMs = info.startTime.getTime();
  const lastEnd = opts.utterances.reduce((m, u) => Math.max(m, u.end ?? u.start), 0);
  const windowEndMs = recordingStartMs + lastEnd + POST_SESSION_BUFFER_MS;

  // Resolve which channels to scrape
  let channelIds = opts.channelIds;
  if (channelIds.length === 0) {
    if (!info.guildId) {
      console.log('[text-chat] No channel IDs configured and guild ID missing from info.txt — skipping');
      return empty;
    }
    console.log(`[text-chat] No channel list configured — sweeping guild ${info.guildId}`);
    channelIds = await listGuildTextChannels(info.guildId);
    console.log(`[text-chat] Found ${channelIds.length} text-capable channels/threads to check`);
  }

  if (channelIds.length === 0) return empty;

  // Fetch from all channels in parallel, skip inaccessible ones
  const allMessages: DiscordMessage[] = [];
  let channelsWithMessages = 0;
  await Promise.all(
    channelIds.map(async (id) => {
      const msgs = await fetchChannelMessages(id, recordingStartMs, windowEndMs);
      if (msgs.length > 0) {
        channelsWithMessages++;
        allMessages.push(...msgs);
      }
    }),
  );

  console.log(
    `[text-chat] Swept ${channelIds.length} channel(s); ${channelsWithMessages} had messages in the session window`,
  );

  if (allMessages.length === 0) return empty;

  const result = messagesToUtterances(allMessages, recordingStartMs, opts.playerMap);
  return result;
}
