import type { UserResponse, CreateUserInput, UpdateUserInput, ResetPasswordResponse } from '@btec-lms/shared'
import i18next from '../i18n/index.js'
import { ApiError, apiFetch } from '../lib/api.js'

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api'

export interface UserListParams {
  search?: string
  role?: 'ADMIN' | 'USER'
  positionId?: string
  isActive?: boolean
  page?: number
  limit?: number
}

export interface AdminUserListResponse {
  data: UserResponse[]
  total: number
  page: number
  limit: number
}

export function listAdminUsers(params: UserListParams = {}): Promise<AdminUserListResponse> {
  const qs = new URLSearchParams()
  if (params.search) qs.set('search', params.search)
  if (params.role) qs.set('role', params.role)
  if (params.positionId) qs.set('positionId', params.positionId)
  if (params.isActive != null) qs.set('isActive', String(params.isActive))
  qs.set('page', String(params.page ?? 1))
  qs.set('limit', String(params.limit ?? 20))
  return apiFetch<AdminUserListResponse>(`/users?${qs.toString()}`)
}

export function createAdminUser(body: CreateUserInput): Promise<UserResponse> {
  return apiFetch<UserResponse>('/users', { method: 'POST', json: body })
}

export function updateAdminUser(id: string, body: UpdateUserInput): Promise<UserResponse> {
  return apiFetch<UserResponse>(`/users/${id}`, { method: 'PATCH', json: body })
}

export function deleteAdminUser(id: string): Promise<void> {
  return apiFetch<void>(`/users/${id}`, { method: 'DELETE' })
}

export function resetAdminUserPassword(id: string): Promise<ResetPasswordResponse> {
  return apiFetch<ResetPasswordResponse>(`/users/${id}/reset-password`, { method: 'POST' })
}

export interface ImportResult {
  created: number
  skipped: number
  errors: { row: number; email: string; reason: string }[]
  tempPasswords: { email: string; tempPassword: string }[]
}

// XHR (not apiFetch) — multipart upload, no need for progress tracking but keeps
// the same 401/session pattern as uploadFileMaterial for consistency.
export function importUsersCsv(file: File): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/users/import`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept-Language', i18next.language)

    xhr.onload = () => {
      let data: unknown
      try { data = JSON.parse(xhr.responseText) } catch { data = {} }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as ImportResult)
      } else {
        const msg = (data as { message?: string })?.message ?? xhr.statusText
        reject(new ApiError(xhr.status, msg, data))
      }
    }

    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(formData)
  })
}
