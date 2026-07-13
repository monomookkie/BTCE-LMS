import type { PositionPublicResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

// public: unauthenticated (RegisterPage) + authenticated USER (BrowseCoursesPage ไม่ต้องใช้ตรงๆ)
export function listPositions(): Promise<PositionPublicResponse[]> {
  return apiFetch<PositionPublicResponse[]>('/positions')
}
