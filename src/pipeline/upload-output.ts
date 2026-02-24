import { uploadVideo } from '../shared/storage.js';

export async function uploadOutput(localPath: string): Promise<string> {
  console.log(`[upload-output] Uploading ${localPath} to GCS...`);
  const publicUrl = await uploadVideo(localPath);
  console.log(`[upload-output] Uploaded → ${publicUrl}`);
  return publicUrl;
}
