import { config } from '../shared/config.js';
import { ReplicateProvider } from '../providers/video/replicate.js';
import { VeoProvider } from '../providers/video/veo.js';
import type { MomentCandidate } from '../shared/types.js';
import type { VideoProvider } from '../providers/video/interface.js';

function getProvider(): VideoProvider {
  if (config.videoProvider === 'veo') return new VeoProvider();
  return new ReplicateProvider();
}

function buildVideoPrompt(moment: MomentCandidate): string {
  const categoryStyles: Record<MomentCandidate['category'], string> = {
    combat: 'Epic fantasy battle scene, dramatic lighting, motion blur, cinematic',
    roleplay: 'Fantasy tavern or castle interior, warm atmospheric lighting, characters conversing',
    comedy: 'Lighthearted fantasy scene, vibrant colors, expressive characters',
    dramatic: 'Dark and moody fantasy environment, tense atmosphere, dramatic shadows',
    epic: 'Grand fantasy vista, sweeping landscape, heroic composition, golden hour lighting',
  };

  const style = categoryStyles[moment.category];
  return `${style}. ${moment.summary}. Dragonlance fantasy setting. No text, no subtitles.`;
}

export async function generateVideos(moments: MomentCandidate[]): Promise<string[]> {
  const provider = getProvider();
  const selected = moments.filter((_, i) => i < 3); // top 3
  const paths: string[] = [];

  for (const moment of selected) {
    const prompt = buildVideoPrompt(moment);
    console.log(`[generate-video] Clip ${moment.rank}: ${moment.category} — ${moment.summary}`);
    const localPath = await provider.generate(prompt, {});
    paths.push(localPath);
  }

  return paths;
}
