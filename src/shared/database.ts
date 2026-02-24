import pg from 'pg';
import { config, requireConfig } from './config.js';
import type { Session, Clip, MomentCandidate } from './types.js';

let pool: pg.Pool | null = null;

export async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;

  requireConfig(['cloudSqlConnectionName']);

  // In production, use Cloud SQL connector. Locally, use direct connection.
  // TODO: wire up @google-cloud/cloud-sql-connector for Cloud Run
  pool = new pg.Pool({ connectionString: config.cloudSqlConnectionName });
  return pool;
}

export async function createSession(audioDir: string): Promise<Session> {
  const db = await getPool();
  const result = await db.query<Session>(
    `INSERT INTO sessions (status, metadata)
     VALUES ('pending', $1)
     RETURNING *`,
    [JSON.stringify({ audio_dir: audioDir })],
  );
  return result.rows[0]!;
}

export async function updateSessionStatus(
  sessionId: string,
  status: Session['status'],
  extra?: Partial<Pick<Session, 'audio_url' | 'transcript_url' | 'transcript_text' | 'error_message' | 'metadata'>>,
): Promise<void> {
  const db = await getPool();
  const fields: string[] = ['status = $2', 'updated_at = now()'];
  const values: unknown[] = [sessionId, status];
  let i = 3;

  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      fields.push(`${key} = $${i++}`);
      values.push(val);
    }
  }

  await db.query(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $1`, values);
}

export async function insertClips(
  sessionId: string,
  moments: MomentCandidate[],
): Promise<Clip[]> {
  const db = await getPool();
  const inserted: Clip[] = [];

  for (const m of moments) {
    const result = await db.query<Clip>(
      `INSERT INTO clips (session_id, start_time, end_time, summary, transcript_excerpt, selected, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        sessionId,
        m.start_time,
        m.end_time,
        m.summary,
        m.transcript_excerpt,
        m.rank <= 3, // top 3 selected
        JSON.stringify({ rank: m.rank, category: m.category, reasoning: m.reasoning }),
      ],
    );
    inserted.push(result.rows[0]!);
  }

  return inserted;
}

export async function updateClipVideo(clipId: string, videoUrl: string, videoPrompt: string): Promise<void> {
  const db = await getPool();
  await db.query(
    `UPDATE clips SET video_url = $2, video_prompt = $3, updated_at = now() WHERE id = $1`,
    [clipId, videoUrl, videoPrompt],
  );
}
