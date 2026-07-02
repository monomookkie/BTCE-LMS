import type {
  QuizAdminResponse,
  CreateQuizInput,
  UpdateQuizInput,
  CreateQuestionInput,
  UpdateQuestionInput,
  AddOptionInput,
  UpdateOptionInput,
} from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function getAdminQuiz(courseId: string): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz`)
}

export function createQuiz(courseId: string, body: CreateQuizInput): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz`, { method: 'POST', json: body })
}

export function updateQuiz(courseId: string, body: UpdateQuizInput): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz`, { method: 'PATCH', json: body })
}

export function deleteQuiz(courseId: string): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/quiz`, { method: 'DELETE' })
}

export function addQuestion(courseId: string, body: CreateQuestionInput): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz/questions`, { method: 'POST', json: body })
}

export function updateQuestion(
  courseId: string,
  questionId: string,
  body: UpdateQuestionInput,
): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz/questions/${questionId}`, {
    method: 'PATCH',
    json: body,
  })
}

export function deleteQuestion(courseId: string, questionId: string): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/quiz/questions/${questionId}`, { method: 'DELETE' })
}

export function addOption(
  courseId: string,
  questionId: string,
  body: AddOptionInput,
): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz/questions/${questionId}/options`, {
    method: 'POST',
    json: body,
  })
}

export function updateOption(
  courseId: string,
  questionId: string,
  optionId: string,
  body: UpdateOptionInput,
): Promise<QuizAdminResponse> {
  return apiFetch<QuizAdminResponse>(`/courses/${courseId}/quiz/questions/${questionId}/options/${optionId}`, {
    method: 'PATCH',
    json: body,
  })
}

export function deleteOption(courseId: string, questionId: string, optionId: string): Promise<void> {
  return apiFetch<void>(`/courses/${courseId}/quiz/questions/${questionId}/options/${optionId}`, {
    method: 'DELETE',
  })
}
