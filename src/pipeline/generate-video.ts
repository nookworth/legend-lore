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
    combat: 'Epic fantasy battle scene, magical energy erupting, dramatic lighting, cinematic camera movement',
    roleplay: 'Fantasy tavern or castle interior, warm atmospheric lighting, characters in conversation',
    comedy: 'Lighthearted fantasy scene, vibrant colors, expressive characters, warm tone',
    dramatic: 'Dark and moody fantasy environment, tense atmosphere, dramatic shadows, slow cinematic pan',
    epic: 'Grand fantasy vista, sweeping landscape, heroic composition, golden hour lighting',
  };

  return `${categoryStyles[moment.category]}. ${moment.visual_description}. Dragonlance fantasy setting. No text, no subtitles.`;
}

export async function generateVideos(moments: MomentCandidate[], outputDir: string): Promise<string[]> {
  const provider = getProvider();
  const selected = moments.filter((_, i) => i < 3); // top 3
  const paths: string[] = [];

  for (const moment of selected) {
    const prompt = buildVideoPrompt(moment);
    console.log(`[generate-video] Clip ${moment.rank}: ${moment.category} — ${moment.summary}`);
    const localPath = await provider.generate(prompt, { outputDir });
    paths.push(localPath);
  }

  return paths;
}
