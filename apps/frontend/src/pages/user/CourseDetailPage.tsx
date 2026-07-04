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
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { formatDate } from '../../lib/format.js'
import { extractYoutubeId } from '../../lib/youtube.js'
import { VideoMaterialCard } from '../../components/course/VideoMaterialCard.js'

// ─── Query key factories ─────────────────────────────────────────────────────

const courseKey = (id: string) => ['courses', id] as const
const materialsKey = (id: string) => ['materials', id] as const
const quizKey = (id: string) => ['quiz', 'take', id] as const
const attemptsKey = (id: string) => ['quiz', 'attempts', id] as const
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

  // ── Loading / error states ───────────────────────────────────────────────

  if (courseLoad) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-40" />
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
            <span>
              {t('course.passScore')}: <strong className="text-slate-700">{course.passScore}%</strong>
            </span>
            {course.expiryMonths != null && (
              <span>
                {t('course.expiryMonths')}:{' '}
                <strong className="text-slate-700">{course.expiryMonths} {t('course.months')}</strong>
              </span>
            )}
            {course.durationMin != null && (
              <span>
                {t('browse.durationMin', { count: course.durationMin })}
              </span>
            )}
          </div>

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
          <Skeleton lines={4} />
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
              const href = material.signedUrl ?? material.url ?? null
              const isFile = material.type === 'PDF' || material.type === 'IMAGE' || material.type === 'DOC'

              // VIDEO ที่ parse เป็น YouTube ID ได้ — ฝังเล่น + track การดูจริง (Tier 3) แทนลิงก์เปิดแท็บใหม่
              // ถ้า parse ไม่ได้ (ไม่ใช่ YouTube) — fallback ไปแสดงแบบเดิม (ลิงก์ธรรมดา)
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
            <Skeleton lines={2} />
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
              {attemptsLoad ? (
                <Skeleton lines={2} />
              ) : attempts.length > 0 ? (
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
                  passScore={course.passScore}
                />
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  )
}
