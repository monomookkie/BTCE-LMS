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

// ADMIN: เช็คว่า course มี enrollment ที่ยัง active อยู่ไหม — ใช้กับ accessType-lock UI
// (เช็คก่อนเปิด edit modal แทนที่จะปล่อยให้ submit แล้วเจอ 400)
export async function courseHasActiveEnrollment(courseId: string): Promise<boolean> {
  const res = await apiFetch<EnrollmentsPage>(`/enrollments?courseId=${courseId}&limit=1`)
  return res.total > 0
}
