// Cloudinary storage interface — implementation ใน Phase 2
// Phase 0: stub เพื่อให้ type-check ผ่านและ import ได้แล้ว

export type UploadResult = {
  fileKey: string
  url: string
  mimeType: string
  sizeBytes: number
}

export type StorageFolder = 'avatars' | 'materials' | 'certificates' | 'training-logs'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function uploadFile(_buffer: Buffer, _folder: StorageFolder, _filename: string): Promise<UploadResult> {
  throw new Error('Storage not configured — implement in Phase 2')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteFile(_fileKey: string): Promise<void> {
  throw new Error('Storage not configured — implement in Phase 2')
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSignedUrl(_fileKey: string, _expiresInSeconds?: number): string {
  throw new Error('Storage not configured — implement in Phase 2')
}
