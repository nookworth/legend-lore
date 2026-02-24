import { uploadAudio } from '../shared/storage.js';

export async function uploadAudioFile(localPath: string): Promise<string> {
  console.log(`[upload-audio] Uploading ${localPath} to GCS...`);
  const gcsUri = await uploadAudio(localPath);
  console.log(`[upload-audio] Uploaded → ${gcsUri}`);
  return gcsUri;
}
