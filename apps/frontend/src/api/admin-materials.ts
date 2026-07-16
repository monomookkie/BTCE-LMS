import type { MaterialAdminResponse, UpdateMaterialInput, CreateLinkMaterialInput } from '@btec-lms/shared'
import i18next from '../i18n/index.js'
import { ApiError, apiFetch } from '../lib/api.js'

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api'

export function listAdminMaterials(courseId: string): Promise<MaterialAdminResponse[]> {
  return apiFetch<MaterialAdminResponse[]>(`/courses/${courseId}/materials`)
}

export function createLinkMaterial(
  courseId: string,
  body: CreateLinkMaterialInput,
): Promise<MaterialAdminResponse> {
  return apiFetch<MaterialAdminResponse>(`/courses/${courseId}/materials/link`, {
    method: 'POST',
    json: body,
  })
}

export function updateMaterial(
  courseId: string,
  materialId: string,
  body: UpdateMaterialInput,
): Promise<MaterialAdminResponse> {
  return apiFetch<MaterialAdminResponse>(`/courses/${courseId}/materials/${materialId}`, {
    method: 'PATCH',
    json: body,
  })
}

export function reorderMaterials(
  courseId: string,
  materialIds: string[],
): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/materials/reorder`, {
    method: 'PATCH',
    json: { materialIds },
  })
}

export function deleteMaterial(courseId: string, materialId: string): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/materials/${materialId}`, { method: 'DELETE' })
}

// XHR upload: supports onprogress for real % tracking
// Note: doesn't go through executeWithRefresh — 401 on upload = session expired, user retries.
export function uploadFileMaterial(
  courseId: string,
  formData: FormData,
  onProgress: (pct: number) => void,
): Promise<MaterialAdminResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/courses/${courseId}/materials`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept-Language', i18next.language)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as MaterialAdminResponse)
      } else {
        const msg = (data as { message?: string })?.message ?? xhr.statusText
        reject(new ApiError(xhr.status, msg, data))
      }
    }

    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(formData)
  })
}

// แทนที่ไฟล์เดิมของ material ประเภท PDF/IMAGE/DOC (+ แก้ชื่อพร้อมกันได้) — ไฟล์บังคับแนบเสมอ
export function replaceMaterialFile(
  courseId: string,
  materialId: string,
  formData: FormData,
  onProgress: (pct: number) => void,
): Promise<MaterialAdminResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PATCH', `${BASE}/courses/${courseId}/materials/${materialId}/file`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept-Language', i18next.language)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as MaterialAdminResponse)
      } else {
        const msg = (data as { message?: string })?.message ?? xhr.statusText
        reject(new ApiError(xhr.status, msg, data))
      }
    }

    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(formData)
  })
}
