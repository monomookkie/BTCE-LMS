import type { MaterialPublicResponse, EnrollmentResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export interface MaterialProgress {
  materialId: string
  openedAt: string | null
  watchedPercent: number
  embedFailed: boolean
}

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

// hydrate % ที่ดูถึงแล้วตอนโหลดหน้าใหม่ — ยังไม่เคยเปิด → { openedAt: null, watchedPercent: 0 }
export function getMaterialProgress(
  enrollmentId: string,
  materialId: string,
): Promise<MaterialProgress> {
  return apiFetch<MaterialProgress>(
    `/enrollments/${enrollmentId}/materials/${materialId}/progress`,
  )
}

// Tier 2: บันทึกว่าเปิดสื่อการเรียนแล้ว (idempotent — เรียกซ้ำได้ไม่มีผลข้างเคียง)
export function openMaterial(
  enrollmentId: string,
  materialId: string,
): Promise<MaterialProgress> {
  return apiFetch<MaterialProgress>(
    `/enrollments/${enrollmentId}/materials/${materialId}/open`,
    { method: 'POST' },
  )
}

// client รายงานว่า YouTube embed โหลดไม่สำเร็จ (network/CSP/timeout) — server จะ fallback เป็น time-gate แบบ LINK
export function markEmbedFailed(
  enrollmentId: string,
  materialId: string,
): Promise<MaterialProgress> {
  return apiFetch<MaterialProgress>(
    `/enrollments/${enrollmentId}/materials/${materialId}/embed-failed`,
    { method: 'POST' },
  )
}

// Tier 3: อัปเดต % ที่ดูวิดีโอถึง (server เก็บค่าสูงสุดเท่านั้น กันไถถอยหลัง)
// durationSeconds: ความยาววิดีโอจาก player.getDuration() — server ใช้คำนวณ time-ceiling กัน watchedPercent ปลอม
export function updateMaterialProgress(
  enrollmentId: string,
  materialId: string,
  watchedPercent: number,
  durationSeconds?: number,
): Promise<MaterialProgress> {
  return apiFetch<MaterialProgress>(
    `/enrollments/${enrollmentId}/materials/${materialId}/progress`,
    { method: 'POST', json: { watchedPercent, ...(durationSeconds != null && { durationSeconds }) } },
  )
}
