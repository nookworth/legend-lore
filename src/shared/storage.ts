import { Storage } from '@google-cloud/storage';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { config, requireConfig } from './config.js';

let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = new Storage();
  }
  return storage;
}

export async function uploadAudio(localPath: string, sessionId: string): Promise<string> {
  requireConfig(['gcsBucketAudio']);
  const gcs = getStorage();
  const destination = `${config.groupId}/sessions/${sessionId}/${path.basename(localPath)}`;
  const bucket = gcs.bucket(config.gcsBucketAudio);
  await bucket.upload(localPath, { destination });
  return `gs://${config.gcsBucketAudio}/${destination}`;
}

export async function uploadVideo(localPath: string, sessionId: string): Promise<string> {
  requireConfig(['gcsBucketVideos']);
  const gcs = getStorage();
  const destination = `${config.groupId}/sessions/${sessionId}/final_recap.mp4`;
  const bucket = gcs.bucket(config.gcsBucketVideos);
  await bucket.upload(localPath, { destination });
  return `https://storage.googleapis.com/${config.gcsBucketVideos}/${destination}`;
}

export async function uploadPortrait(localPath: string, slug: string): Promise<string> {
  requireConfig(['gcsBucketAssets']);
  const gcs = getStorage();
  const destination = `${config.groupId}/portraits/portrait_${slug}.png`;
  const bucket = gcs.bucket(config.gcsBucketAssets);
  await bucket.upload(localPath, { destination });
  return `gs://${config.gcsBucketAssets}/${destination}`;
}

export async function downloadPortrait(slug: string, localPath: string): Promise<boolean> {
  if (!config.gcsBucketAssets) return false;
  const gcs = getStorage();
  const remotePath = `${config.groupId}/portraits/portrait_${slug}.png`;
  const file = gcs.bucket(config.gcsBucketAssets).file(remotePath);
  try {
    const [exists] = await file.exists();
    if (!exists) return false;
    const readStream = file.createReadStream();
    await pipeline(readStream, createWriteStream(localPath));
    return true;
  } catch {
    return false;
  }
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
