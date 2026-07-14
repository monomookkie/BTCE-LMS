import type { ChangePasswordInput, UpdateProfileInput, UserResponse, ConsentInput } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function patchProfile(body: Omit<UpdateProfileInput, 'language'>): Promise<UserResponse> {
  return apiFetch<UserResponse>('/users/me', { method: 'PATCH', json: body })
}

export function changePassword(body: ChangePasswordInput): Promise<void> {
  return apiFetch<void>('/auth/change-password', { method: 'POST', json: body })
}

export function recordConsent(body: ConsentInput): Promise<{ message: 'ok' }> {
  return apiFetch<{ message: 'ok' }>('/users/me/consent', { method: 'POST', json: body })
}
