import { S3Client } from '@aws-sdk/client-s3';
import { shutdownRegistry } from '../utils/helpers/shutdown.helpers.js';
import { serverConfig } from './index.js';

// SeaweedFS in dev; S3, R2 or Supabase Storage in production by changing env only.
export const s3Client = new S3Client({
  endpoint: serverConfig.S3_ENDPOINT,
  region: serverConfig.S3_REGION,
  // SeaweedFS serves buckets as paths (host/bucket/key), not subdomains.
  forcePathStyle: serverConfig.S3_FORCE_PATH_STYLE,
  credentials:
    serverConfig.S3_ACCESS_KEY && serverConfig.S3_SECRET_KEY
      ? { accessKeyId: serverConfig.S3_ACCESS_KEY, secretAccessKey: serverConfig.S3_SECRET_KEY }
      : undefined,
  // The SDK's default extra checksums aren't supported by every S3-compatible store.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

shutdownRegistry.register(async () => s3Client.destroy());
