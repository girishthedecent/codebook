import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { serverConfig } from '../config/index.js';
import { s3Client } from '../config/storage.config.js';

function bucket() {
  if (!serverConfig.S3_BUCKET) throw new Error('S3_BUCKET is not set');
  return serverConfig.S3_BUCKET;
}

/** A stream needs its length up front: S3 rejects streamed uploads of unknown size. */
export async function putObject(
  key: string,
  body: Readable | Buffer,
  { contentType, contentLength }: { contentType: string; contentLength: number },
) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
  );
}

export async function getObjectStream(key: string) {
  const { Body } = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!Body) throw new Error(`Object ${key} has no body`);
  return Body as Readable;
}

/** The whole object in memory (for files with a size cap), or null when it doesn't exist. */
export async function getObjectBuffer(key: string) {
  try {
    const { Body } = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!Body) throw new Error(`Object ${key} has no body`);
    return Buffer.from(await Body.transformToByteArray());
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

/** Size and type of an object, or null when it doesn't exist. */
export async function headObject(key: string) {
  try {
    const head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: head.ContentLength ?? 0, contentType: head.ContentType };
  } catch (error) {
    if (error instanceof NotFound) return null;
    throw error;
  }
}

export async function deleteObject(key: string) {
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Deletes every object under `prefix` and returns how many there were. */
export async function deletePrefix(prefix: string) {
  // An empty prefix would empty the whole bucket.
  if (!prefix.endsWith('/')) throw new Error(`Refusing to delete prefix "${prefix}"`);

  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? []).flatMap((object) =>
      object.Key ? [{ Key: object.Key }] : [],
    );
    if (keys.length > 0) {
      // A page holds at most 1000 keys, which is also DeleteObjects' limit.
      const result = await s3Client.send(
        new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: keys, Quiet: true } }),
      );
      if (result.Errors?.length) {
        throw new Error(`Failed to delete ${result.Errors.length} objects under ${prefix}`);
      }
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/** True when the bucket exists and the credentials can reach it. */
export async function bucketReachable() {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket() }));
    return true;
  } catch {
    return false;
  }
}
