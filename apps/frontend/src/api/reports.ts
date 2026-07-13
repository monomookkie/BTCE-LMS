import type { DashboardSummary, ComplianceList, CourseReport, CourseCommentsList, UserReport } from '@btec-lms/shared'
import { apiFetch, apiFetchBlob } from '../lib/api.js'

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/reports/dashboard')
}

export type EnrollmentStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED'

export interface ComplianceParams {
  courseId?: string
  status?: EnrollmentStatus
  page?: number
  limit?: number
}

function buildComplianceQs(params: ComplianceParams): string {
  const qs = new URLSearchParams()
  if (params.courseId) qs.set('courseId', params.courseId)
  if (params.status) qs.set('status', params.status)
  if (params.page != null) qs.set('page', String(params.page))
  if (params.limit != null) qs.set('limit', String(params.limit))
  return qs.toString()
}

export function getComplianceList(params: ComplianceParams = {}): Promise<ComplianceList> {
  const query = buildComplianceQs(params)
  return apiFetch<ComplianceList>(`/reports/compliance${query ? `?${query}` : ''}`)
}

// Content-Disposition filename from the server uses YYYY-MM-DD; we override the
// download filename client-side to YYYYMMDD to match the required convention.
export async function downloadComplianceCsv(
  params: Pick<ComplianceParams, 'courseId' | 'status'> = {},
): Promise<void> {
  const query = buildComplianceQs(params)
  const blob = await apiFetchBlob(`/reports/compliance/export${query ? `?${query}` : ''}`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  a.href = url
  a.download = `compliance-report-${datePart}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => { URL.revokeObjectURL(url) }, 200)
}

// ─── By Course / By User (item 4) ──────────────────────────────────────────

export function getCourseReport(courseId: string): Promise<CourseReport> {
  return apiFetch<CourseReport>(`/reports/by-course?courseId=${courseId}`)
}

export function getCourseComments(
  courseId: string,
  params: { page?: number; limit?: number } = {},
): Promise<CourseCommentsList> {
  const qs = new URLSearchParams({ courseId })
  if (params.page != null) qs.set('page', String(params.page))
  if (params.limit != null) qs.set('limit', String(params.limit))
  return apiFetch<CourseCommentsList>(`/reports/by-course/comments?${qs.toString()}`)
}

export function getUserReport(userId: string): Promise<UserReport> {
  return apiFetch<UserReport>(`/reports/by-user?userId=${userId}`)
}
