import type { CoursePublicResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export interface CoursesPage {
  data: CoursePublicResponse[]
  total: number
  page: number
  limit: number
}

export function listPublishedCourses(params?: { page?: number }): Promise<CoursesPage> {
  const qs = new URLSearchParams({ page: String(params?.page ?? 1), limit: '100' })
  return apiFetch<CoursesPage>(`/courses?${qs.toString()}`)
}

export function getCourse(id: string): Promise<CoursePublicResponse> {
  return apiFetch<CoursePublicResponse>(`/courses/${id}`)
}
