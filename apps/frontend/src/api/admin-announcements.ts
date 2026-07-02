import type { AnnouncementAdminResponse, AnnouncementListAdmin, UpdateAnnouncementInput } from '@btec-lms/shared'
import i18next from '../i18n/index.js'
import { ApiError, apiFetch } from '../lib/api.js'

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api'

export interface AdminAnnouncementListParams {
  page?: number
  limit?: number
}

export function listAdminAnnouncements(params: AdminAnnouncementListParams = {}): Promise<AnnouncementListAdmin> {
  const qs = new URLSearchParams()
  if (params.page != null) qs.set('page', String(params.page))
  qs.set('limit', String(params.limit ?? 20))
  return apiFetch<AnnouncementListAdmin>(`/announcements?${qs.toString()}`)
}

// multipart XHR — file ไม่บังคับ, ห้ามใช้ apiFetch เพราะต้องส่ง FormData ไม่ใช่ JSON
// Note: ไม่ผ่าน executeWithRefresh — 401 ตรงนี้ = session expired, ให้ user retry
export function createAnnouncement(formData: FormData): Promise<AnnouncementAdminResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/announcements`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept-Language', i18next.language)

    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as AnnouncementAdminResponse)
      } else {
        const msg = (data as { message?: string })?.message ?? xhr.statusText
        reject(new ApiError(xhr.status, msg, data))
      }
    }

    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(formData)
  })
}

export function updateAnnouncement(id: string, body: UpdateAnnouncementInput): Promise<AnnouncementAdminResponse> {
  return apiFetch<AnnouncementAdminResponse>(`/announcements/${id}`, { method: 'PATCH', json: body })
}

export function deleteAnnouncement(id: string): Promise<void> {
  return apiFetch<void>(`/announcements/${id}`, { method: 'DELETE' })
}
