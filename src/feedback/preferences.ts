import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PENDING_MARKER = '## Pending review';
const PREFERENCES_PATH = path.join('data', 'preferences.md');

export interface SplitResult {
  curated: string;
  pending: string;
}

export function splitPreferences(md: string): SplitResult {
  const markerIndex = md.indexOf(`\n${PENDING_MARKER}`);
  if (markerIndex === -1) {
    const trimmed = md.trim();
    return { curated: trimmed, pending: '' };
  }
  return {
    curated: md.slice(0, markerIndex).trim(),
    pending: md.slice(markerIndex + `\n${PENDING_MARKER}`.length).trim(),
  };
}

export function appendCandidates(md: string, candidatesMd: string): string {
  if (!candidatesMd.trim()) return md;

  const trimmed = md.trimEnd();
  const markerIndex = trimmed.indexOf(`\n${PENDING_MARKER}`);

  if (markerIndex === -1) {
    return `${trimmed}\n\n${PENDING_MARKER}\n\n${candidatesMd}\n`;
  }

  const before = trimmed.slice(0, markerIndex);
  return `${before}\n\n${PENDING_MARKER}\n\n${candidatesMd}\n`;
}

export async function readPreferences(): Promise<string> {
  try {
    return await readFile(PREFERENCES_PATH, 'utf-8');
  } catch {
    return '';
  }
}

export async function writePreferences(content: string): Promise<void> {
  await mkdir(path.dirname(PREFERENCES_PATH), { recursive: true });
  await writeFile(PREFERENCES_PATH, content);
}
