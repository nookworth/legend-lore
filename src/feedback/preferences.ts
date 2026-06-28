import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PENDING_MARKER = '## Pending review';
const PREFERENCES_PATH = path.join('data', 'preferences.md');

export interface SplitResult {
  curated: string;
  pending: string;
}

export function splitPreferences(md: string): SplitResult {
  // Match the marker whether it appears mid-file (preceded by \n) or at the
  // very start of the file (no leading newline), so a hand-authored file that
  // begins with ## Pending review doesn't leak pending items into curated.
  const match = md.match(/(?:^|\n)(## Pending review)/m);
  if (!match || match.index === undefined) {
    return { curated: md.trim(), pending: '' };
  }
  const markerStart = match.index === 0 ? 0 : match.index + 1; // skip the \n when not at start
  const afterMarker = markerStart + PENDING_MARKER.length;
  return {
    curated: md.slice(0, match.index).trim(),
    pending: md.slice(afterMarker).trim(),
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
