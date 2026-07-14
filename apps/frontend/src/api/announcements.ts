import type { AnnouncementListPublic, LatestAnnouncementResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function listPublicAnnouncements(params: { limit?: number } = {}): Promise<AnnouncementListPublic> {
  const limit = params.limit ?? 20
  return apiFetch<AnnouncementListPublic>(`/announcements?page=1&limit=${limit}`)
}

export function getLatestAnnouncement(): Promise<LatestAnnouncementResponse> {
  return apiFetch<LatestAnnouncementResponse>('/announcements/latest')
}
