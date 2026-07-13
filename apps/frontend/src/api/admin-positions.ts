import type {
  PositionAdminResponse,
  CreatePositionInput,
  UpdatePositionInput,
  MergePositionInput,
} from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function listAdminPositions(): Promise<PositionAdminResponse[]> {
  return apiFetch<PositionAdminResponse[]>('/positions/admin')
}

export function createAdminPosition(body: CreatePositionInput): Promise<PositionAdminResponse> {
  return apiFetch<PositionAdminResponse>('/positions', { method: 'POST', json: body })
}

export function updateAdminPosition(id: string, body: UpdatePositionInput): Promise<PositionAdminResponse> {
  return apiFetch<PositionAdminResponse>(`/positions/${id}`, { method: 'PATCH', json: body })
}

export function mergeAdminPosition(id: string, body: MergePositionInput): Promise<{ message: 'ok' }> {
  return apiFetch<{ message: 'ok' }>(`/positions/${id}/merge`, { method: 'POST', json: body })
}

export function deleteAdminPosition(id: string): Promise<{ message: 'ok' }> {
  return apiFetch<{ message: 'ok' }>(`/positions/${id}`, { method: 'DELETE' })
}
