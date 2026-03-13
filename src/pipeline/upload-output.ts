import { uploadVideo } from '../shared/storage.js';

export async function uploadOutput(localPath: string, sessionId: string): Promise<string> {
  console.log(`[upload-output] Uploading ${localPath} to GCS...`);
  const publicUrl = await uploadVideo(localPath, sessionId);
  console.log(`[upload-output] Uploaded → ${publicUrl}`);
  return publicUrl;
}
