import { useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ExternalLink,
  Download,
  FileText,
  Play,
  Image,
} from 'lucide-react'
import type {
  MaterialPublicResponse,
  MaterialType,
  QuizForUserResponse,
  QuizAttemptResponse,
  SurveyForUserResponse,
} from '@btec-lms/shared'
import { Card } from '../../components/ui/Card.js'
import { Button } from '../../components/ui/Button.js'
import { ProgressBar } from '../../components/ui/ProgressBar.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { getCourse } from '../../api/courses.js'
import { listMyEnrollments } from '../../api/enrollments.js'
import { listMaterials, markMaterialComplete } from '../../api/materials.js'
import { getQuizForTaking, submitQuizAnswers, getMyQuizAttempts } from '../../api/quizzes.js'
import { getSurveyForTaking, submitSurveyAnswers } from '../../api/surveys.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { formatDate } from '../../lib/format.js'
import { extractYoutubeId } from '../../lib/youtube.js'
import { VideoMaterialCard } from '../../components/course/VideoMaterialCard.js'
import { GatedMaterialLink } from '../../components/course/GatedMaterialLink.js'

// ─── Query key factories ─────────────────────────────────────────────────────

const courseKey = (id: string) => ['courses', id] as const
const materialsKey = (id: string) => ['materials', id] as const
const quizKey = (id: string) => ['quiz', 'take', id] as const
const attemptsKey = (id: string) => ['quiz', 'attempts', id] as const
const surveyKey = (id: string) => ['survey', 'take', id] as const
const ENROLLMENTS_ME_KEY = ['enrollments', 'me'] as const
const CERTS_ME_KEY = ['certificates', 'me'] as const

// ─── Material icon map ───────────────────────────────────────────────────────

const MATERIAL_ICONS: Record<MaterialType, React.ReactNode> = {
  PDF:   <FileText size={15} />,
  VIDEO: <Play size={15} />,
  LINK:  <ExternalLink size={15} />,
  IMAGE: <Image size={15} />,
  DOC:   <FileText size={15} />,
}

// ─── QuizRunner ──────────────────────────────────────────────────────────────

interface QuizRunnerProps {
  courseId: string
  quiz: QuizForUserResponse
  attemptsUsed: number
  passScore: number
}

function QuizRunner({ courseId, quiz, attemptsUsed, passScore }: QuizRunnerProps) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()

  const [state, setState] = useState<'idle' | 'taking' | 'submitted'>('idle')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [lastAttempt, setLastAttempt] = useState<QuizAttemptResponse | null>(null)

  const canAttempt = quiz.maxAttempts === null || attemptsUsed < quiz.maxAttempts
  const allAnswered = quiz.questions.length > 0 && quiz.questions.every(q => answers[q.id] != null)

  const submitMutation = useMutation({
    mutationFn: () => submitQuizAnswers(courseId, answers),
    onSuccess: (attempt) => {
      setLastAttempt(attempt)
      setState('submitted')
      // Refetch attempts always (update count regardless of pass/fail)
      void qc.invalidateQueries({ queryKey: attemptsKey(courseId) })
      if (attempt.passed) {
        void qc.invalidateQueries({ queryKey: ENROLLMENTS_ME_KEY })
        void qc.invalidateQueries({ queryKey: CERTS_ME_KEY })
      }
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  // Blocked — used all attempts
  if (!canAttempt) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
        {t('courseDetail.noAttemptsLeft', { max: quiz.maxAttempts })}
      </div>
    )
  }

  // ── idle ──
  if (state === 'idle') {
    return (
      <Button
        onClick={() => { setAnswers({}); setState('taking') }}
      >
        {attemptsUsed > 0 ? t('courseDetail.retakeQuiz') : t('courseDetail.startQuiz')}
      </Button>
    )
  }

  // ── taking ──
  if (state === 'taking') {
    return (
      <div className="space-y-6">
        {quiz.questions.map((q, idx) => (
          <div key={q.id} className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">
              {t('quiz.questionN', { n: idx + 1, total: quiz.questions.length })}
            </p>
            <p className="text-sm text-slate-700">{q.text}</p>
            <div className="space-y-2">
              {q.options.map(opt => (
                <label
                  key={opt.id}
                  className={[
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                    answers[q.id] === opt.id
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-slate-200 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={opt.id}
                    checked={answers[q.id] === opt.id}
                    onChange={() => setAnswers(prev => ({ ...prev, [q.id]: opt.id }))}
                    className="mt-0.5 accent-brand-500"
                  />
                  <span className="text-sm text-slate-700">{opt.text}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
          <Button
            isLoading={submitMutation.isPending}
            disabled={!allAnswered || submitMutation.isPending}
            onClick={() => { submitMutation.mutate() }}
          >
            {submitMutation.isPending ? t('quiz.submitting') : t('quiz.submitQuiz')}
          </Button>
          {!allAnswered && (
            <p className="text-xs text-slate-400">{t('quiz.answerAll')}</p>
          )}
        </div>
      </div>
    )
  }

  // ── submitted ──
  if (state === 'submitted' && lastAttempt != null) {
    const canRetake = quiz.maxAttempts === null || attemptsUsed < quiz.maxAttempts

    return (
      <div className="space-y-5">
        {/* Score banner */}
        <div
          className={[
            'flex items-center gap-4 rounded-lg border p-4',
            lastAttempt.passed
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-red-200 bg-red-50',
          ].join(' ')}
        >
          <span
            className={[
              'text-3xl font-bold',
              lastAttempt.passed ? 'text-emerald-700' : 'text-red-700',
            ].join(' ')}
          >
            {lastAttempt.score}%
          </span>
          <div>
            <p className={['text-sm font-semibold', lastAttempt.passed ? 'text-emerald-700' : 'text-red-700'].join(' ')}>
              {lastAttempt.passed ? t('quiz.passed') : t('quiz.failed')}
            </p>
            <p className="text-xs text-slate-500">
              {t('quiz.passThreshold')}: {passScore}%
              {' · '}
              {formatDate(lastAttempt.createdAt, i18n.language)}
            </p>
          </div>
        </div>

        {/* Cert earned banner */}
        {lastAttempt.passed && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-semibold text-brand-700">
              🎉 {t('courseDetail.certEarned')}
            </p>
            <Link
              to="/certs"
              className="mt-1 inline-block text-sm text-brand-600 underline underline-offset-2 hover:text-brand-700"
            >
              {t('courseDetail.viewCerts')}
            </Link>
          </div>
        )}

        {/* Answer review
            NOTE: isCorrect ไม่แสดง — backend ไม่ส่ง isCorrect ใน attempt response
            ถ้าต้องการเฉลยในอนาคต ต้องเพิ่ม endpoint GET /courses/:id/quiz/attempts/:attemptId
            ที่ return answers พร้อม isCorrect หลังผ่าน policy review */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('quiz.attemptResult')}
          </h4>
          {quiz.questions.map((q, idx) => {
            const chosenId = lastAttempt.answers[q.id]
            const chosen = q.options.find(o => o.id === chosenId)
            return (
              <div key={q.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="text-xs text-slate-400">Q{idx + 1}</p>
                <p className="mt-0.5 font-medium text-slate-700">{q.text}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {chosen != null
                    ? <>{t('courseDetail.yourAnswer')}: <span className="font-medium text-slate-700">{chosen.text}</span></>
                    : <span className="text-slate-400">{t('courseDetail.notAnswered')}</span>
                  }
                </p>
              </div>
            )
          })}
        </div>

        {/* Retry */}
        {!lastAttempt.passed && canRetake && (
          <Button
            variant="outline"
            onClick={() => { setAnswers({}); setLastAttempt(null); setState('taking') }}
          >
            {t('courseDetail.retakeQuiz')}
          </Button>
        )}
      </div>
    )
  }

  return null
}

// ─── SurveyRunner ────────────────────────────────────────────────────────────

interface SurveyRunnerProps {
  courseId: string
  survey: SurveyForUserResponse
  isCompleted: boolean
}

function SurveyRunner({ courseId, survey, isCompleted }: SurveyRunnerProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()

  const [answers, setAnswers] = useState<Record<string, number | string>>({})
  const [submitted, setSubmitted] = useState(false)

  const ratingQuestions = survey.questions.filter(q => q.type === 'RATING')
  const allRatingsAnswered = ratingQuestions.every(q => answers[q.id] != null)

  const submitMutation = useMutation({
    mutationFn: () => submitSurveyAnswers(courseId, answers),
    onSuccess: () => {
      setSubmitted(true)
      void qc.invalidateQueries({ queryKey: ENROLLMENTS_ME_KEY })
      void qc.invalidateQueries({ queryKey: surveyKey(courseId) })
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  // ตอบไปแล้ว (จาก server) หรือเพิ่งตอบเสร็จรอบนี้ (local, กันฟอร์มโผล่ค้างระหว่างรอ refetch)
  if (survey.alreadySubmitted || submitted) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-700">
          {t('surveyTake.thankYou')}
        </p>
        {isCompleted && (
          <p className="mt-1 text-sm text-emerald-600">
            🎉 {t('surveyTake.courseCompleted')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {survey.questions.map((q, idx) => (
        <div key={q.id} className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            {t('quiz.questionN', { n: idx + 1, total: survey.questions.length })}
          </p>
          <p className="text-sm text-slate-700">{q.text}</p>

          {q.type === 'RATING' ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAnswers(prev => ({ ...prev, [q.id]: n }))}
                    className={[
                      'flex h-11 w-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors',
                      answers[q.id] === n
                        ? 'border-brand-400 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>{t('surveyTake.ratingLow')}</span>
                <span>{t('surveyTake.ratingHigh')}</span>
              </div>
            </div>
          ) : (
            <textarea
              value={(answers[q.id] as string | undefined) ?? ''}
              onChange={(e) => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
              maxLength={2000}
              rows={3}
              placeholder={t('surveyTake.textPlaceholder')}
              className="w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
            />
          )}
        </div>
      ))}

      <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
        <Button
          isLoading={submitMutation.isPending}
          disabled={!allRatingsAnswered || submitMutation.isPending}
          onClick={() => { submitMutation.mutate() }}
        >
          {submitMutation.isPending ? t('surveyTake.submitting') : t('surveyTake.submitSurvey')}
        </Button>
        {!allRatingsAnswered && (
          <p className="text-xs text-slate-400">{t('surveyTake.ratingRequired')}</p>
        )}
      </div>
    </div>
  )
}

// mirror ของ course header card จริง — category tag, title, description, progress row
function CourseHeaderSkeleton() {
  return (
    <Card>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        <Skeleton className="h-3.5 w-full" />
        <div className="flex flex-wrap gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      </div>
    </Card>
  )
}

// mirror ของแถว material ใน list จริง (ก่อนแยก branch VIDEO/GatedMaterialLink) — icon + title/type + ปุ่มท้ายแถว
function MaterialRowSkeleton() {
  return (
    <li className="flex items-center gap-3 py-3">
      <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-7 w-24 shrink-0 rounded-lg" />
    </li>
  )
}

// mirror ของ quiz section จริง — title+meta บรรทัดบน, attempt history rows
function QuizSectionSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
  )
}

// mirror ของ survey section จริง — คำถาม 2 ข้อ (rating buttons + textarea) + ปุ่ม submit
function SurveySectionSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3.5 w-full" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11 w-11 rounded-lg" />)}
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
  )
}

// ─── CourseDetailPage ────────────────────────────────────────────────────────

export default function CourseDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const id = rawId ?? ''
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: course, isLoading: courseLoad, isError: courseErr } = useQuery({
    queryKey: courseKey(id),
    queryFn: () => getCourse(id),
    enabled: id !== '',
    staleTime: 60_000,
  })

  const { data: enrollPage, isLoading: enrollLoad } = useQuery({
    queryKey: ENROLLMENTS_ME_KEY,
    queryFn: () => listMyEnrollments(),
    staleTime: 60_000,
  })

  const enrollment = useMemo(
    () => enrollPage?.data.find(e => e.courseId === id),
    [enrollPage, id],
  )

  const isEnrolled = !enrollLoad && enrollment != null

  const { data: materials, isLoading: matLoad, isError: matErr } = useQuery({
    queryKey: materialsKey(id),
    queryFn: () => listMaterials(id),
    enabled: isEnrolled,
    staleTime: 60_000,
    retry: false,
  })

  // Preload quiz — /take ไม่มี isCorrect (backend strip ผ่าน response schema)
  const { data: quiz, isError: quizErr, error: quizError } = useQuery({
    queryKey: quizKey(id),
    queryFn: () => getQuizForTaking(id),
    enabled: isEnrolled,
    staleTime: 300_000,
    retry: false,
  })

  const { data: attempts = [], isLoading: attemptsLoad } = useQuery({
    queryKey: attemptsKey(id),
    queryFn: () => getMyQuizAttempts(id),
    enabled: isEnrolled,
    staleTime: 30_000,
  })

  // survey เป็น optional ต่อ course — 404 แปลว่า course นี้ไม่มี survey เลย (ไม่ต้องแสดง section)
  const { data: survey, isError: surveyErr, error: surveyError } = useQuery({
    queryKey: surveyKey(id),
    queryFn: () => getSurveyForTaking(id),
    enabled: isEnrolled,
    staleTime: 60_000,
    retry: false,
  })

  // ── Mark complete mutation ────────────────────────────────────────────────

  const markCompleteMutation = useMutation({
    mutationFn: (materialId: string) =>
      markMaterialComplete(enrollment!.id, materialId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENROLLMENTS_ME_KEY })
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  // ── Derived state ────────────────────────────────────────────────────────

  const completedSet = useMemo(
    () => new Set(enrollment?.completedMaterials ?? []),
    [enrollment],
  )

  const quizNotFound = quizErr && quizError instanceof ApiError && quizError.status === 404
  const surveyNotFound = surveyErr && surveyError instanceof ApiError && surveyError.status === 404

  // survey ปลดล็อกเมื่อ material ครบ + quiz ผ่านแล้ว (ตรงกับ backend checkCanComplete)
  // quizPassed = จริงเมื่อ course ไม่มี quiz เลย หรือมี attempt ที่ passed แล้ว
  const materialsComplete = enrollment?.progress === 100
  const quizPassed = quizNotFound || attempts.some(a => a.passed)
  const surveyPrereqsLoading = matLoad || attemptsLoad || (quiz == null && !quizErr)

  // ── Loading / error states ───────────────────────────────────────────────

  if (courseLoad) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-4 w-24" />
        <CourseHeaderSkeleton />
        <Card header={<h2 className="text-sm font-semibold text-slate-700">{t('courseDetail.materials')}</h2>}>
          <ul className="divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((_, i) => <MaterialRowSkeleton key={i} />)}
          </ul>
        </Card>
      </div>
    )
  }

  if (courseErr || course == null) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-500">{t('common.error')}</p>
        <Link to="/courses" className="mt-2 block text-sm text-brand-500 hover:underline">
          {t('courseDetail.back')}
        </Link>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      {/* Back */}
      <Link
        to="/courses"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={14} />
        {t('courseDetail.back')}
      </Link>

      {/* ── Course header ── */}
      <Card>
        <div className="space-y-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-brand-500">
              {course.category}
            </span>
            <h1 className="mt-1 text-xl font-bold text-slate-800">{course.title}</h1>
          </div>

          {course.description != null && (
            <p className="text-sm leading-relaxed text-slate-600">{course.description}</p>
          )}

          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            {course.expiryMonths != null && (
              <span>
                {t('course.expiryMonths')}:{' '}
                <strong className="text-slate-700">{course.expiryMonths} {t('course.months')}</strong>
              </span>
            )}
          </div>

          {course.paperSavingSheets != null && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {t('course.paperSaving', { count: course.paperSavingSheets })}
            </p>
          )}

          {enrollment != null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{t('enrollment.progress')}</span>
                <StatusBadge type="enrollment" status={enrollment.status} />
              </div>
              <ProgressBar value={enrollment.progress} showValue />
            </div>
          )}

          {enrollment != null && enrollment.status !== 'COMPLETED' && (
            <p className="text-xs text-slate-400">{t('courseDetail.certCondition')}</p>
          )}
        </div>
      </Card>

      {/* ── Materials ── */}
      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">{t('courseDetail.materials')}</h2>
        }
      >
        {enrollLoad || matLoad ? (
          <ul className="divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((_, i) => <MaterialRowSkeleton key={i} />)}
          </ul>
        ) : !isEnrolled ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('courseDetail.notEnrolled')}</p>
        ) : matErr ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('common.error')}</p>
        ) : materials == null || materials.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('courseDetail.noMaterials')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {materials.map((material: MaterialPublicResponse) => {
              const isDone = completedSet.has(material.id)
              const isMarking =
                markCompleteMutation.isPending &&
                markCompleteMutation.variables === material.id

              // VIDEO ที่ parse เป็น YouTube ID ได้ — ฝังเล่น + track การดูจริง (Tier 3) แทนลิงก์เปิดแท็บใหม่
              if (material.type === 'VIDEO' && material.url != null) {
                const videoId = extractYoutubeId(material.url)
                if (videoId != null && enrollment != null) {
                  return (
                    <VideoMaterialCard
                      key={material.id}
                      material={material}
                      videoId={videoId}
                      enrollmentId={enrollment.id}
                      isDone={isDone}
                      isMarking={isMarking}
                      markCompletePending={markCompleteMutation.isPending}
                      onMarkComplete={() => { markCompleteMutation.mutate(material.id) }}
                    />
                  )
                }
              }

              // PDF/LINK/IMAGE/DOC ปกติ — หรือ VIDEO ที่ parse YouTube ID ไม่ได้ (reuse embed-failed path
              // กัน dead-end: วิดีโอที่ไม่ใช่ YouTube ไม่มีทาง track % ได้เลย ต้อง fallback เป็น time-gate)
              if (enrollment != null) {
                return (
                  <GatedMaterialLink
                    key={material.id}
                    material={material}
                    enrollmentId={enrollment.id}
                    isDone={isDone}
                    isMarking={isMarking}
                    markCompletePending={markCompleteMutation.isPending}
                    onMarkComplete={() => { markCompleteMutation.mutate(material.id) }}
                  />
                )
              }

              // enrollment null (ไม่ควรเกิด — ทั้ง query ถูก gate ด้วย isEnrolled อยู่แล้ว) — fallback แบบไม่ gate
              const href = material.signedUrl ?? material.url ?? null
              const isFile = material.type === 'PDF' || material.type === 'IMAGE' || material.type === 'DOC'

              return (
                <li key={material.id} className="flex items-center gap-3 py-3">
                  <span className="shrink-0 text-slate-400">
                    {MATERIAL_ICONS[material.type]}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{material.title}</p>
                    <p className="text-xs text-slate-400">
                      {/* dynamic key — as never bypasses literal key check (same pattern as StatusBadge) */}
                      {t(`material.types.${material.type}` as never) as string}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {href != null && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                      >
                        {isFile
                          ? <><Download size={12} />{t('courseDetail.download')}</>
                          : <><ExternalLink size={12} />{t('courseDetail.open')}</>
                        }
                      </a>
                    )}

                    {isDone ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle2 size={14} />
                        {t('courseDetail.completed')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={isMarking}
                        disabled={markCompleteMutation.isPending}
                        leftIcon={<Circle size={12} />}
                        onClick={() => { markCompleteMutation.mutate(material.id) }}
                      >
                        {t('courseDetail.markComplete')}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* ── Quiz / Assessment ── */}
      {isEnrolled && (
        <Card
          header={
            <h2 className="text-sm font-semibold text-slate-700">{t('courseDetail.quizSection')}</h2>
          }
        >
          {quizNotFound ? (
            <p className="py-6 text-center text-sm text-slate-400">{t('courseDetail.noQuiz')}</p>
          ) : quiz == null && !quizErr ? (
            <QuizSectionSkeleton />
          ) : quiz != null ? (
            <div className="space-y-5">
              {/* Quiz meta */}
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-semibold text-slate-700">{quiz.title}</h3>
                <span className="text-xs text-slate-400">
                  {quiz.maxAttempts != null
                    ? t('courseDetail.attemptsUsed', { used: attempts.length, max: quiz.maxAttempts })
                    : t('courseDetail.unlimitedAttempts')
                  }
                </span>
              </div>

              {/* Attempt history */}
              {attemptsLoad ? null : attempts.length > 0 ? (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {t('courseDetail.attemptHistory')}
                  </h4>
                  <ul className="space-y-1.5">
                    {[...attempts].reverse().map((a, i) => (
                      <li key={a.id} className="flex items-center gap-3 text-xs">
                        <span className="w-6 text-slate-400">#{i + 1}</span>
                        <span className="w-12 font-semibold text-slate-700">{a.score}%</span>
                        <StatusBadge type="quiz" status={a.passed ? 'passed' : 'failed'} />
                        <span className="text-slate-400">{formatDate(a.createdAt, i18n.language)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* QuizRunner */}
              <div className="border-t border-slate-100 pt-4">
                <QuizRunner
                  courseId={id}
                  quiz={quiz}
                  attemptsUsed={attempts.length}
                  passScore={quiz.passScore}
                />
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* ── Survey — optional ต่อ course, 404 = ไม่มี survey เลย ไม่แสดง section ── */}
      {isEnrolled && !surveyNotFound && (
        <Card
          header={
            <h2 className="text-sm font-semibold text-slate-700">{t('courseDetail.surveySection')}</h2>
          }
        >
          {surveyPrereqsLoading || (survey === undefined && !surveyErr) ? (
            <SurveySectionSkeleton />
          ) : !materialsComplete ? (
            <p className="py-6 text-center text-sm text-slate-400">{t('courseDetail.surveyNeedsMaterials')}</p>
          ) : !quizPassed ? (
            <p className="py-6 text-center text-sm text-slate-400">{t('courseDetail.surveyNeedsQuizPass')}</p>
          ) : survey != null ? (
            <SurveyRunner
              courseId={id}
              survey={survey}
              isCompleted={enrollment?.status === 'COMPLETED'}
            />
          ) : null}
        </Card>
      )}
    </div>
  )
}
