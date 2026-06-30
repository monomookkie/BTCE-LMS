import type { EnrollmentResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export interface EnrollmentsPage {
  data: EnrollmentResponse[]
  total: number
  page: number
  limit: number
}

export function listMyEnrollments(): Promise<EnrollmentsPage> {
  return apiFetch<EnrollmentsPage>('/enrollments/me?page=1&limit=100')
}

export function selfEnroll(courseId: string): Promise<EnrollmentResponse> {
  return apiFetch<EnrollmentResponse>('/enrollments/self', {
    method: 'POST',
    json: { courseId },
  })
}
