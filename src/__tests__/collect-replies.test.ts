import { describe, it, expect } from 'vitest';
import { filterReplies } from '../feedback/collect-replies.js';
import type { DiscordMessage } from '../shared/discord.js';

function msg(
  id: string,
  content: string,
  author: string,
  replyTo?: string,
  bot = false,
): DiscordMessage {
  return {
    id,
    content,
    timestamp: new Date().toISOString(),
    author: { id, username: author, bot },
    ...(replyTo ? { message_reference: { message_id: replyTo } } : {}),
  };
}

const RECAP_MSG_ID = 'recap-123';

describe('filterReplies', () => {
  it('keeps replies matching the recap message id', () => {
    const messages = [
      msg('1', 'Great recap!', 'alice', RECAP_MSG_ID),
      msg('2', 'Loved it!', 'bob', RECAP_MSG_ID),
    ];
    expect(filterReplies(messages, RECAP_MSG_ID)).toEqual([
      { author: 'alice', text: 'Great recap!' },
      { author: 'bob', text: 'Loved it!' },
    ]);
  });

  it('filters out messages without a matching message_reference', () => {
    const messages = [
      msg('1', 'Great recap!', 'alice', RECAP_MSG_ID),
      msg('2', 'Off-topic', 'bob', 'other-msg'),
      msg('3', 'No reference', 'carol'),
    ];
    const result = filterReplies(messages, RECAP_MSG_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.author).toBe('alice');
  });

  it('filters out bot replies', () => {
    const messages = [
      msg('1', 'Great recap!', 'alice', RECAP_MSG_ID),
      msg('2', 'Bot reply', 'bot1', RECAP_MSG_ID, true),
    ];
    const result = filterReplies(messages, RECAP_MSG_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.author).toBe('alice');
  });

  it('filters out empty content', () => {
    const messages = [
      msg('1', '  ', 'alice', RECAP_MSG_ID),
      msg('2', '', 'bob', RECAP_MSG_ID),
    ];
    expect(filterReplies(messages, RECAP_MSG_ID)).toEqual([]);
  });

  it('returns empty array for no messages', () => {
    expect(filterReplies([], RECAP_MSG_ID)).toEqual([]);
  });
});
