import { Storage } from '@google-cloud/storage';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { config, requireConfig } from './config.js';

let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    requireConfig(['gcsBucketAudio']);
    storage = new Storage();
  }
  return storage;
}

export async function uploadAudio(localPath: string): Promise<string> {
  const gcs = getStorage();
  const fileName = path.basename(localPath);
  const bucket = gcs.bucket(config.gcsBucketAudio);
  await bucket.upload(localPath, { destination: fileName });
  return `gs://${config.gcsBucketAudio}/${fileName}`;
}

export async function uploadVideo(localPath: string): Promise<string> {
  requireConfig(['gcsBucketVideos']);
  const gcs = getStorage();
  const fileName = path.basename(localPath);
  const bucket = gcs.bucket(config.gcsBucketVideos);
  await bucket.upload(localPath, { destination: fileName });
  return `https://storage.googleapis.com/${config.gcsBucketVideos}/${fileName}`;
}

export async function getSignedUrl(gcsUri: string): Promise<string> {
  const gcs = getStorage();
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid GCS URI: ${gcsUri}`);
  const [, bucketName, fileName] = match;
  const file = gcs.bucket(bucketName!).file(fileName!);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });
  return url;
}
