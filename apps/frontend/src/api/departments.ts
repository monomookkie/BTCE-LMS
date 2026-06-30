import type { DepartmentItem } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function listDepartments(): Promise<DepartmentItem[]> {
  return apiFetch<DepartmentItem[]>('/users/departments')
}
