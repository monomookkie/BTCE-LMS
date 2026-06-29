import { createHash } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'

export type UploadResult = {
  fileKey: string
  mimeType: string
  sizeBytes: number
}

export type StorageFolder = 'avatars' | 'materials' | 'certificates' | 'training-logs' | 'announcements'

export interface StorageProvider {
  upload(buffer: Buffer, folder: StorageFolder, filename: string, mimeType: string): Promise<UploadResult>
  delete(fileKey: string): Promise<void>
  getSignedUrl(fileKey: string, expiresInSeconds?: number): string
}

// ─── Fake provider สำหรับ NODE_ENV=test ───────────────────────────────────────
// deterministic: fileKey มาจาก sha256(buffer) — ไม่ยิง network เลย

class FakeStorageProvider implements StorageProvider {
  async upload(buffer: Buffer, folder: StorageFolder, filename: string, mimeType: string): Promise<UploadResult> {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12)
    const fileKey = `fake/${folder}/${hash}-${filename}`
    return { fileKey, mimeType, sizeBytes: buffer.length }
  }

  async delete(_fileKey: string): Promise<void> {
    // no-op — test ไม่มีไฟล์จริงให้ลบ
  }

  getSignedUrl(fileKey: string, _expiresInSeconds = 3600): string {
    return `https://fake.storage.test/${fileKey}?token=test`
  }
}

// ─── Cloudinary provider สำหรับ development / production ─────────────────────

class CloudinaryProvider implements StorageProvider {
  constructor() {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw new Error(
        'Cloudinary credentials missing: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET',
      )
    }
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    })
  }

  async upload(buffer: Buffer, folder: StorageFolder, filename: string, mimeType: string): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto', use_filename: true, unique_filename: true },
        (error, result) => {
          if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'))
          resolve({
            fileKey: result.public_id,
            mimeType: result.format ? `${result.resource_type}/${result.format}` : mimeType,
            sizeBytes: result.bytes,
          })
        },
      )
      stream.end(buffer)
    })
  }

  async delete(fileKey: string): Promise<void> {
    await cloudinary.uploader.destroy(fileKey)
  }

  getSignedUrl(fileKey: string, expiresInSeconds = 3600): string {
    return cloudinary.url(fileKey, {
      secure: true,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    })
  }
}

// ─── Singleton — เลือก provider ตาม NODE_ENV ──────────────────────────────────

let _provider: StorageProvider | null = null

export function getStorage(): StorageProvider {
  if (!_provider) {
    _provider = env.NODE_ENV === 'test' ? new FakeStorageProvider() : new CloudinaryProvider()
  }
  return _provider
}

export async function uploadFile(
  buffer: Buffer,
  folder: StorageFolder,
  filename: string,
  mimeType: string,
): Promise<UploadResult> {
  return getStorage().upload(buffer, folder, filename, mimeType)
}

export async function deleteFile(fileKey: string): Promise<void> {
  return getStorage().delete(fileKey)
}

export function getSignedUrl(fileKey: string, expiresInSeconds?: number): string {
  return getStorage().getSignedUrl(fileKey, expiresInSeconds)
}
