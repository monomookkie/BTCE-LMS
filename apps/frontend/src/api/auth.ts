import type { UserResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export interface MeResponse extends UserResponse {
  mustChangePassword: boolean
}

export interface LoginInput {
  email: string
  password: string
}

export function login(body: LoginInput): Promise<MeResponse> {
  // skipRefresh: 401 จาก /auth/login = credential ผิด ไม่ใช่ token expired
  return apiFetch<MeResponse>('/auth/login', { method: 'POST', json: body, skipRefresh: true })
}

export function logout(): Promise<void> {
  return apiFetch<void>('/auth/logout', { method: 'POST' })
}

export function me(): Promise<MeResponse> {
  return apiFetch<MeResponse>('/auth/me')
}
