import type {
  SurveyForUserResponse,
  SubmitSurveyInput,
  SurveyResponseRecord,
} from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function getSurveyForTaking(courseId: string): Promise<SurveyForUserResponse> {
  return apiFetch<SurveyForUserResponse>(`/courses/${courseId}/survey/take`)
}

export function submitSurveyAnswers(
  courseId: string,
  answers: SubmitSurveyInput['answers'],
): Promise<SurveyResponseRecord> {
  return apiFetch<SurveyResponseRecord>(`/courses/${courseId}/survey/submit`, {
    method: 'POST',
    json: { answers },
  })
}
