import type { NotificationListResponse, NotificationResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export interface NotificationListParams {
  page?: number
  limit?: number
}

export function listMyNotifications(params: NotificationListParams = {}): Promise<NotificationListResponse> {
  const qs = new URLSearchParams()
  if (params.page != null) qs.set('page', String(params.page))
  qs.set('limit', String(params.limit ?? 20))
  return apiFetch<NotificationListResponse>(`/notifications/me?${qs.toString()}`)
}

export function markNotificationRead(id: string): Promise<NotificationResponse> {
  return apiFetch<NotificationResponse>(`/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllNotificationsRead(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/notifications/read-all', { method: 'PATCH' })
}
