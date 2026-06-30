import type { ChangePasswordInput, UpdateProfileInput, UserResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function patchProfile(body: Omit<UpdateProfileInput, 'language'>): Promise<UserResponse> {
  return apiFetch<UserResponse>('/users/me', { method: 'PATCH', json: body })
}

export function changePassword(body: ChangePasswordInput): Promise<void> {
  return apiFetch<void>('/auth/change-password', { method: 'POST', json: body })
}
