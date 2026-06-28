import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readRecapFile, latestRecap } from '../pipeline/recap-record.js';
import type { RecapEntry } from '../pipeline/recap-record.js';

const SESSIONS_DIR = path.join('data', 'sessions');

export interface SessionEntry {
  name: string;
  hasRecap: boolean;
}

export function pickLatestSessionWithRecap(
  entries: SessionEntry[],
): SessionEntry | null {
  const withRecap = entries
    .filter((e) => e.hasRecap)
    .sort((a, b) => b.name.localeCompare(a.name));
  return withRecap[0] ?? null;
}

export async function findLatestRecap(): Promise<{
  sessionId: string;
  recap: RecapEntry;
} | null> {
  let dirEntries: string[];
  try {
    dirEntries = await readdir(SESSIONS_DIR, { withFileTypes: false });
  } catch {
    return null;
  }

  const sessionNames = dirEntries.filter((name) => {
    return /^\d{4}-\d{2}-\d{2}/.test(name);
  });

  const sessionEntries: SessionEntry[] = await Promise.all(
    sessionNames.map(async (name) => {
      try {
        const file = await readRecapFile(path.join(SESSIONS_DIR, name));
        return { name, hasRecap: file !== null };
      } catch {
        return { name, hasRecap: false };
      }
    }),
  );

  const picked = pickLatestSessionWithRecap(sessionEntries);
  if (!picked) return null;

  const file = await readRecapFile(path.join(SESSIONS_DIR, picked.name));
  if (!file) return null;

  const recap = latestRecap(file.recaps);
  if (!recap) return null;

  return { sessionId: picked.name, recap };
}
