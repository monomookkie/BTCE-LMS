import type { ExternalCertResponse } from '@btec-lms/shared'
import i18next from '../i18n/index.js'
import { ApiError, apiFetch } from '../lib/api.js'

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api'

export function listExternalCerts(userId?: string): Promise<ExternalCertResponse[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  return apiFetch<ExternalCertResponse[]>(`/external-certs${qs}`)
}

// XHR upload: metadata (title/issuer/issuedAt/expiresAt) + optional file in one
// multipart request — same pattern as uploadFileMaterial (admin-materials.ts).
// Note: doesn't go through executeWithRefresh — 401 on upload = session expired.
export function createExternalCert(
  formData: FormData,
  onProgress?: (pct: number) => void,
): Promise<ExternalCertResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/external-certs`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept-Language', i18next.language)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as ExternalCertResponse)
      } else {
        const msg = (data as { message?: string })?.message ?? xhr.statusText
        reject(new ApiError(xhr.status, msg, data))
      }
    }

    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(formData)
  })
}
