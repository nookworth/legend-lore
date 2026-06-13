import { readdir } from 'node:fs/promises';
import path from 'node:path';

const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.mp3', '.wav', '.m4a', '.ogg']);

/**
 * Strip the per-session channel index from a track label, e.g. "1-mekjonesy" →
 * "mekjonesy". The numeric prefix reflects recording order and shifts whenever a
 * player is absent (so a 7-player map can become "1-mekjonesy" this week and
 * "2-mekjonesy" the next), so only the Discord handle that follows it is a
 * stable identity.
 */
export function normalizeHandle(label: string): string {
  return label.replace(/^\d+-/, '').trim().toLowerCase();
}

/** Loose name match so trailing spaces / casing don't split a character in two. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Discord handles (prefix-stripped) for every audio track present in a session dir. */
export async function audioHandles(audioDir: string): Promise<string[]> {
  const files = await readdir(audioDir);
  return files
    .filter((f) => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .map((f) => normalizeHandle(path.basename(f, path.extname(f))));
}

/**
 * Re-key the stable handle→character map onto a specific session's speaker labels.
 * The transcript labels speakers by this session's prefixed track names
 * ("1-mekjonesy"), which drift between sessions, so the label→character hint given
 * to moment selection has to be rebuilt each run. Labels with no mapped character
 * (e.g. the DM, guests) are omitted.
 */
export function sessionPlayerMap(
  labels: string[],
  playerMap: Record<string, string>,
): Record<string, string> {
  const byHandle = new Map<string, string>();
  for (const [key, character] of Object.entries(playerMap)) {
    byHandle.set(normalizeHandle(key), character);
  }

  const out: Record<string, string> = {};
  for (const label of labels) {
    const character = byHandle.get(normalizeHandle(label));
    if (character) out[label] = character;
  }
  return out;
}

export interface Roll {
  present: string[];          // campaign character names who attended, sorted
  absent: string[];           // campaign character names who did NOT attend, sorted
  nonPlayerHandles: string[]; // attending handles that map to no campaign character (DM, guests, unmapped)
}

/**
 * Take attendance for a session: cross-reference the handles that have a track
 * this session against the player→character map, then split the campaign roster
 * into who was present and who was absent. Handles that map to a non-character
 * (e.g. the DM) or have no mapping at all are reported separately, so absent
 * *characters* never leak into portraits, narration, or moment selection.
 *
 * Returned `present`/`absent` names are the canonical strings from `campaignNames`
 * (matching is loose, but output preserves the campaign's exact spelling so it can
 * be used directly to filter the campaign roster).
 */
export function takeRoll(
  handles: string[],
  playerMap: Record<string, string>,
  campaignNames: Iterable<string>,
): Roll {
  // Normalize map keys so prefix drift between sessions doesn't break lookups.
  const handleToCharacter = new Map<string, string>();
  for (const [key, character] of Object.entries(playerMap)) {
    handleToCharacter.set(normalizeHandle(key), character);
  }

  // Loose-key → canonical campaign name, so player_map values match despite
  // trailing whitespace or casing differences.
  const canonicalByName = new Map<string, string>();
  for (const name of campaignNames) {
    canonicalByName.set(normalizeName(name), name);
  }

  const present = new Set<string>();
  const nonPlayerHandles: string[] = [];
  for (const handle of handles) {
    const mapped = handleToCharacter.get(handle);
    const canonical = mapped ? canonicalByName.get(normalizeName(mapped)) : undefined;
    if (canonical) present.add(canonical);
    else nonPlayerHandles.push(handle);
  }

  const absent = [...canonicalByName.values()].filter((name) => !present.has(name));
  return {
    present: [...present].sort(),
    absent: absent.sort(),
    nonPlayerHandles,
  };
}
