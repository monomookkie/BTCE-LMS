import type { DashboardSummary, ComplianceList } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/reports/dashboard')
}

export interface ComplianceParams {
  departmentId?: string
  courseId?: string
  page?: number
  limit?: number
}

export function getComplianceList(params: ComplianceParams = {}): Promise<ComplianceList> {
  const qs = new URLSearchParams()
  if (params.departmentId) qs.set('departmentId', params.departmentId)
  if (params.courseId) qs.set('courseId', params.courseId)
  if (params.page != null) qs.set('page', String(params.page))
  if (params.limit != null) qs.set('limit', String(params.limit))
  const query = qs.toString()
  return apiFetch<ComplianceList>(`/reports/compliance${query ? `?${query}` : ''}`)
}
