import { uploadAudio } from '../shared/storage.js';

export async function uploadAudioFile(localPath: string, sessionId: string): Promise<string> {
  console.log(`[upload-audio] Uploading ${localPath} to GCS...`);
  const gcsUri = await uploadAudio(localPath, sessionId);
  console.log(`[upload-audio] Uploaded → ${gcsUri}`);
  return gcsUri;
}
