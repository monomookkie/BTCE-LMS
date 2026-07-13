import type {
  CourseAdminResponse,
  CreateCourseInput,
  UpdateCourseInput,
  SetCoursePositionsInput,
} from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export interface CourseListParams {
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  search?: string
  page?: number
  limit?: number
}

export interface AdminCourseListResponse {
  data: CourseAdminResponse[]
  total: number
  page: number
  limit: number
}

export function listAdminCourses(params: CourseListParams = {}): Promise<AdminCourseListResponse> {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.search) qs.set('search', params.search)
  if (params.page != null) qs.set('page', String(params.page))
  qs.set('limit', String(params.limit ?? 50))
  return apiFetch<AdminCourseListResponse>(`/courses?${qs.toString()}`)
}

export function getAdminCourse(id: string): Promise<CourseAdminResponse> {
  return apiFetch<CourseAdminResponse>(`/courses/${id}`)
}

export function createAdminCourse(body: CreateCourseInput): Promise<CourseAdminResponse> {
  return apiFetch<CourseAdminResponse>('/courses', { method: 'POST', json: body })
}

export function updateAdminCourse(id: string, body: UpdateCourseInput): Promise<CourseAdminResponse> {
  return apiFetch<CourseAdminResponse>(`/courses/${id}`, { method: 'PATCH', json: body })
}

export function updateCourseStatus(
  id: string,
  status: 'PUBLISHED' | 'ARCHIVED',
): Promise<CourseAdminResponse> {
  return apiFetch<CourseAdminResponse>(`/courses/${id}/status`, { method: 'PATCH', json: { status } })
}

export function deleteAdminCourse(id: string): Promise<void> {
  return apiFetch<void>(`/courses/${id}`, { method: 'DELETE' })
}

export function setCoursePositions(id: string, body: SetCoursePositionsInput): Promise<CourseAdminResponse> {
  return apiFetch<CourseAdminResponse>(`/courses/${id}/positions`, { method: 'PUT', json: body })
}
