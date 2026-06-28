import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface RecapEntry {
  runId: string;
  messageId: string;
  channelId: string;
  postedAt: string;
}

export interface RecapFile {
  sessionId: string;
  recaps: RecapEntry[];
}

export function upsertRecap(recaps: RecapEntry[], rec: RecapEntry): RecapEntry[] {
  const idx = recaps.findIndex((r) => r.runId === rec.runId);
  if (idx >= 0) {
    const copy = [...recaps];
    copy[idx] = rec;
    return copy;
  }
  return [...recaps, rec];
}

export function latestRecap(recaps: RecapEntry[]): RecapEntry | null {
  if (recaps.length === 0) return null;
  return recaps.reduce((best, r) =>
    r.postedAt > best.postedAt ? r : best,
  );
}

export async function readRecapFile(sessionDir: string): Promise<RecapFile | null> {
  try {
    const raw = await readFile(path.join(sessionDir, 'recap_message.json'), 'utf-8');
    return JSON.parse(raw) as RecapFile;
  } catch {
    return null;
  }
}

export async function writeRecapRecord(
  sessionDir: string,
  sessionId: string,
  entry: RecapEntry,
): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
  const existing = await readRecapFile(sessionDir);
  const recaps = existing ? upsertRecap(existing.recaps, entry) : [entry];
  const data: RecapFile = { sessionId, recaps };
  await writeFile(
    path.join(sessionDir, 'recap_message.json'),
    JSON.stringify(data, null, 2),
  );
}
