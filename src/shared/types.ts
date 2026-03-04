export interface Utterance {
  speaker: string; // mapped from channel number via channel_map
  text: string;
  start: number; // milliseconds
  end: number; // milliseconds
}

export interface MomentCandidate {
  rank: number;
  start_time: number; // milliseconds
  end_time: number; // milliseconds
  summary: string;
  transcript_excerpt: string;
  category: 'combat' | 'roleplay' | 'comedy' | 'dramatic' | 'epic';
  reasoning: string;
  visual_description: string;
}

export interface NarrativeSegment {
  text: string; // narration copy → TTS
  image: Buffer; // generated illustration → title card background
}

export interface Narrative {
  intro: NarrativeSegment;
  bridges: NarrativeSegment[]; // 2 bridges for 3 clips
  outro: NarrativeSegment;
}

export interface Session {
  id: string;
  status: 'pending' | 'transcribing' | 'selecting' | 'generating' | 'complete' | 'failed';
  audio_url: string | null;
  transcript_url: string | null;
  transcript_text: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Clip {
  id: string;
  session_id: string;
  start_time: number;
  end_time: number;
  summary: string;
  transcript_excerpt: string;
  video_prompt: string | null;
  video_url: string | null;
  selected: boolean;
  metadata: Record<string, unknown>;
}

export interface VideoOptions {
  duration?: number;
  width?: number;
  height?: number;
  outputDir?: string;
}

export interface PipelineState {
  sessionId: string;
  audioDir: string;
  mergedAudioPath: string | null;
  utterances: Utterance[];
  transcriptText: string | null;
  moments: MomentCandidate[];
  narrative: Narrative | null;
  narrationPaths: string[];
  videoPaths: string[];
  outputPath: string | null;
}
