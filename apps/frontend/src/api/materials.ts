import type { MaterialPublicResponse, EnrollmentResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function listMaterials(courseId: string): Promise<MaterialPublicResponse[]> {
  return apiFetch<MaterialPublicResponse[]>(`/courses/${courseId}/materials`)
}

export function markMaterialComplete(
  enrollmentId: string,
  materialId: string,
): Promise<EnrollmentResponse> {
  return apiFetch<EnrollmentResponse>(
    `/enrollments/${enrollmentId}/complete-material/${materialId}`,
    { method: 'POST' },
  )
}
