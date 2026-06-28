export interface Utterance {
  speaker: string; // mapped from channel number via channel_map
  text: string;
  start: number; // milliseconds
  end?: number;  // milliseconds; omitted for point-in-time events (e.g. Discord text messages)
}

export interface MomentCandidate {
  rank: number;
  start_time: number; // milliseconds
  end_time: number; // milliseconds
  summary: string;
  transcript_excerpt: string;
  attributions?: Array<{ quote: string; speaker: string }>; // verbatim quotes → speaker, for any directly quotable lines in this moment
  preceding_events: string; // 1-2 sentences on what happened between the previous moment (or session start) and this one
  category: 'combat' | 'roleplay' | 'comedy' | 'dramatic' | 'epic';
  reasoning: string;
  visual_description: string;
}

export interface NarrativeSegment {
  label: string; // e.g. 'intro', 'moment_1', 'outro'
  text: string;  // narration copy → TTS
  image: Buffer; // generated illustration → title card background
}

// Flat ordered list: [intro, moment_1, moment_2, moment_3, outro]
export type Narrative = NarrativeSegment[];

