-- Initial schema for Scrying Glass
-- Port of supabase/migrations/20260131000001_initial_schema.sql

CREATE TABLE IF NOT EXISTS sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'transcribing', 'selecting', 'generating', 'complete', 'failed')),
  audio_url TEXT,
  transcript_url TEXT,
  transcript_text TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS clips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_time INTEGER NOT NULL,  -- milliseconds
  end_time INTEGER NOT NULL,    -- milliseconds
  summary TEXT NOT NULL,
  transcript_excerpt TEXT,
  video_prompt TEXT,
  video_url TEXT,
  selected BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  UNIQUE(clip_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_clips_session_id ON clips(session_id);
CREATE INDEX IF NOT EXISTS idx_clips_selected ON clips(selected) WHERE selected = true;
CREATE INDEX IF NOT EXISTS idx_votes_clip_id ON votes(clip_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
