import type {
  SurveyAdminResponse,
  CreateSurveyQuestionInput,
  UpdateSurveyQuestionInput,
  SurveyResponseRecord,
} from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function getAdminSurvey(courseId: string): Promise<SurveyAdminResponse> {
  return apiFetch<SurveyAdminResponse>(`/courses/${courseId}/survey`)
}

// Survey มี metadata แค่ courseId (ไม่มี title/passScore เหมือน quiz) — POST ไม่ต้องมี body
export function createSurvey(courseId: string): Promise<SurveyAdminResponse> {
  return apiFetch<SurveyAdminResponse>(`/courses/${courseId}/survey`, { method: 'POST' })
}

export function deleteSurvey(courseId: string): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/survey`, { method: 'DELETE' })
}

export function addSurveyQuestion(
  courseId: string,
  body: CreateSurveyQuestionInput,
): Promise<SurveyAdminResponse> {
  return apiFetch<SurveyAdminResponse>(`/courses/${courseId}/survey/questions`, { method: 'POST', json: body })
}

export function updateSurveyQuestion(
  courseId: string,
  questionId: string,
  body: UpdateSurveyQuestionInput,
): Promise<SurveyAdminResponse> {
  return apiFetch<SurveyAdminResponse>(`/courses/${courseId}/survey/questions/${questionId}`, {
    method: 'PATCH',
    json: body,
  })
}

export function deleteSurveyQuestion(courseId: string, questionId: string): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/survey/questions/${questionId}`, { method: 'DELETE' })
}

// สำหรับ ConfirmDialog เตือนก่อนลบ survey ทั้งชุด — นับว่ามีคนตอบไปแล้วกี่คน
export function getSurveyResponses(courseId: string): Promise<SurveyResponseRecord[]> {
  return apiFetch<SurveyResponseRecord[]>(`/courses/${courseId}/survey/responses`)
}
