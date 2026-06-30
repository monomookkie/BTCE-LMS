import type { QuizForUserResponse, QuizAttemptResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function getQuizForTaking(courseId: string): Promise<QuizForUserResponse> {
  return apiFetch<QuizForUserResponse>(`/courses/${courseId}/quiz/take`)
}

// score ไม่ส่งจาก client — backend คำนวณเอง
export function submitQuizAnswers(
  courseId: string,
  answers: Record<string, string>,
): Promise<QuizAttemptResponse> {
  return apiFetch<QuizAttemptResponse>(`/courses/${courseId}/quiz/submit`, {
    method: 'POST',
    json: { answers },
  })
}

export function getMyQuizAttempts(courseId: string): Promise<QuizAttemptResponse[]> {
  return apiFetch<QuizAttemptResponse[]>(`/courses/${courseId}/quiz/attempts`)
}
