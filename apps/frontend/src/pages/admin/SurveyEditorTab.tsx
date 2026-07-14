import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Edit2, ArrowUp, ArrowDown, Star, MessageSquare } from 'lucide-react'
import type { SurveyAdminResponse } from '@btec-lms/shared'
import {
  getAdminSurvey,
  createSurvey,
  deleteSurvey,
  addSurveyQuestion,
  updateSurveyQuestion,
  deleteSurveyQuestion,
  getSurveyResponses,
} from '../../api/admin-surveys.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { Card } from '../../components/ui/Card.js'
import { Skeleton } from '../../components/ui/Skeleton.js'

type SurveyQuestion = SurveyAdminResponse['questions'][number]

const QUESTION_TYPE_ICON = { RATING: <Star size={13} />, TEXT: <MessageSquare size={13} /> }

// ─── Add / Edit question modal (type + bilingual text) ────────────────────────

const questionFormSchema = z.object({
  type: z.enum(['RATING', 'TEXT']),
  textEn: z.string().min(1).max(2000),
  textTh: z.string().max(2000).optional(),
})
type QuestionFormValues = z.infer<typeof questionFormSchema>

interface QuestionModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
  question?: SurveyQuestion | null | undefined // undefined/null = create mode
}

function QuestionModal({ isOpen, onClose, courseId, question }: QuestionModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const isEdit = question != null

  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<QuestionFormValues>({
      resolver: zodResolver(questionFormSchema),
      values: question
        ? { type: question.type, textEn: question.textEn, textTh: question.textTh ?? '' }
        : { type: 'RATING', textEn: '', textTh: '' },
    })

  const handleClose = () => {
    reset({ type: 'RATING', textEn: '', textTh: '' })
    onClose()
  }

  const onSubmit = async (values: QuestionFormValues) => {
    try {
      const updated = isEdit
        ? await updateSurveyQuestion(courseId, question.id, {
            type: values.type,
            textEn: values.textEn,
            ...(values.textTh?.trim() ? { textTh: values.textTh.trim() } : { textTh: null }),
          })
        : await addSurveyQuestion(courseId, {
            type: values.type,
            textEn: values.textEn,
            ...(values.textTh?.trim() ? { textTh: values.textTh.trim() } : {}),
          })
      qc.setQueryData(['admin', 'survey', courseId], updated)
      toast.success(isEdit ? t('surveyEditor.questionUpdated') : t('surveyEditor.questionAdded'))
      handleClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEdit ? t('surveyEditor.editQuestion') : t('surveyEditor.addQuestion')}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select
              label={t('surveyEditor.questionType')}
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'RATING', label: t('surveyEditor.typeRating') },
                { value: 'TEXT', label: t('surveyEditor.typeText') },
              ]}
            />
          )}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={`${t('surveyEditor.questionTextEn')} *`} error={errors.textEn?.message} {...register('textEn')} />
          <Input label={t('surveyEditor.questionTextTh')} {...register('textTh')} />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Question card ──────────────────────────────────────────────────────────

interface QuestionCardProps {
  question: SurveyQuestion
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
}

function QuestionCard({ question, index, total, onMoveUp, onMoveDown, onEdit, onDelete }: QuestionCardProps) {
  const { t } = useTranslation()

  return (
    <Card noPadding>
      <div className="flex items-start gap-3 p-4">
        <div className="flex flex-col pt-1">
          <button onClick={onMoveUp} disabled={index === 0} className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30" title={t('common.moveUp')}>
            <ArrowUp size={13} />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30" title={t('common.moveDown')}>
            <ArrowDown size={13} />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {QUESTION_TYPE_ICON[question.type]}
              {question.type === 'RATING' ? t('surveyEditor.typeRating') : t('surveyEditor.typeText')}
            </span>
          </div>
          <p className="text-sm font-medium text-slate-800">{index + 1}. {question.textEn}</p>
          {question.textTh && <p className="text-xs text-slate-400">{question.textTh}</p>}
        </div>

        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} title={t('common.edit')}>
            <Edit2 size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title={t('common.delete')} className="text-red-400 hover:text-red-600">
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

// mirror ของ QuestionCard จริง — order buttons + type badge + text บรรทัดบน + action buttons
function QuestionCardSkeleton() {
  return (
    <Card noPadding>
      <div className="flex items-start gap-3 p-4">
        <div className="flex flex-col gap-1 pt-1">
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex shrink-0 gap-1">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-6 w-6 rounded" />
        </div>
      </div>
    </Card>
  )
}

// ─── SurveyEditorTab ────────────────────────────────────────────────────────

interface SurveyEditorTabProps {
  courseId: string
  isArchived: boolean
}

export default function SurveyEditorTab({ courseId, isArchived }: SurveyEditorTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [addQuestionOpen, setAddQuestionOpen] = useState(false)
  const [editQuestion, setEditQuestion] = useState<SurveyQuestion | null>(null)
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<SurveyQuestion | null>(null)
  const [deleteSurveyOpen, setDeleteSurveyOpen] = useState(false)
  const [deleteSurveyResponseCount, setDeleteSurveyResponseCount] = useState<number | null>(null)

  const { data: survey, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'survey', courseId],
    queryFn: () => getAdminSurvey(courseId),
    enabled: !!courseId,
    retry: false,
  })
  const surveyNotFound = isError && error instanceof ApiError && error.status === 404

  const createSurveyMutation = useMutation({
    mutationFn: () => createSurvey(courseId),
    onSuccess: (created) => {
      qc.setQueryData(['admin', 'survey', courseId], created)
      toast.success(t('surveyEditor.surveyCreated'))
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const reorderQuestionMutation = useMutation({
    mutationFn: async ({ aId, aOrder, bId, bOrder }: { aId: string; aOrder: number; bId: string; bOrder: number }) => {
      await updateSurveyQuestion(courseId, aId, { order: bOrder })
      return updateSurveyQuestion(courseId, bId, { order: aOrder })
    },
    onSuccess: (updated) => qc.setQueryData(['admin', 'survey', courseId], updated),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const deleteQuestionMutation = useMutation({
    mutationFn: (questionId: string) => deleteSurveyQuestion(courseId, questionId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'survey', courseId] })
      toast.success(t('surveyEditor.questionDeleted'))
      setDeleteQuestionTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const deleteSurveyMutation = useMutation({
    mutationFn: () => deleteSurvey(courseId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['admin', 'survey', courseId] })
      toast.success(t('surveyEditor.surveyDeleted'))
      setDeleteSurveyOpen(false)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    if (!survey) return
    const questions = [...survey.questions].sort((a, b) => a.order - b.order)
    const swapIdx = direction === 'up' ? index - 1 : index + 1
    const a = questions[index]
    const b = questions[swapIdx]
    if (!a || !b) return
    reorderQuestionMutation.mutate({ aId: a.id, aOrder: a.order, bId: b.id, bOrder: b.order })
  }

  // เตือนก่อนลบ survey ทั้งชุด — ดึงจำนวนคนที่ตอบไปแล้วมาโชว์ใน ConfirmDialog (ลบได้อิสระ ไม่ block)
  const openDeleteSurveyDialog = async () => {
    setDeleteSurveyOpen(true)
    try {
      const responses = await getSurveyResponses(courseId)
      setDeleteSurveyResponseCount(responses.length)
    } catch {
      setDeleteSurveyResponseCount(null)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <QuestionCardSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  if (isError && !surveyNotFound) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
        <span>{t('common.error')}</span>
        <button onClick={() => void refetch()} className="font-medium underline">{t('common.retry')}</button>
      </div>
    )
  }

  if (surveyNotFound || !survey) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center">
        <p className="mb-1 text-sm font-medium text-slate-500">{t('surveyEditor.noSurvey')}</p>
        <p className="mb-4 text-xs text-slate-400">{t('surveyEditor.surveyOptionalHint')}</p>
        {!isArchived && (
          <Button
            size="sm"
            leftIcon={<Plus size={13} />}
            isLoading={createSurveyMutation.isPending}
            onClick={() => createSurveyMutation.mutate()}
          >
            {t('surveyEditor.createSurvey')}
          </Button>
        )}
      </div>
    )
  }

  const sortedQuestions = [...survey.questions].sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-4">
      {/* Survey header — no settings, just delete-whole-survey */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">{t('surveyEditor.title')}</h3>
            <p className="text-xs text-slate-400">{t('surveyEditor.surveyOptionalHint')}</p>
          </div>
          {!isArchived && (
            <Button size="sm" variant="danger" leftIcon={<Trash2 size={13} />} onClick={() => void openDeleteSurveyDialog()}>
              {t('surveyEditor.deleteSurvey')}
            </Button>
          )}
        </div>
      </Card>

      {/* Questions */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">{t('surveyEditor.questions')}</h4>
        {!isArchived && (
          <Button size="sm" variant="outline" leftIcon={<Plus size={13} />} onClick={() => setAddQuestionOpen(true)}>
            {t('surveyEditor.addQuestion')}
          </Button>
        )}
      </div>

      {sortedQuestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
          {t('surveyEditor.noQuestions')}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedQuestions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={idx}
              total={sortedQuestions.length}
              onMoveUp={() => handleMoveQuestion(idx, 'up')}
              onMoveDown={() => handleMoveQuestion(idx, 'down')}
              onEdit={() => setEditQuestion(q)}
              onDelete={() => setDeleteQuestionTarget(q)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <QuestionModal isOpen={addQuestionOpen} onClose={() => setAddQuestionOpen(false)} courseId={courseId} />
      <QuestionModal
        isOpen={editQuestion !== null}
        onClose={() => setEditQuestion(null)}
        courseId={courseId}
        question={editQuestion}
      />

      <ConfirmDialog
        isOpen={deleteSurveyOpen}
        onClose={() => setDeleteSurveyOpen(false)}
        onConfirm={() => deleteSurveyMutation.mutate()}
        title={t('surveyEditor.deleteSurvey')}
        message={
          deleteSurveyResponseCount != null && deleteSurveyResponseCount > 0
            ? t('surveyEditor.deleteSurveyConfirmWithResponses', { count: deleteSurveyResponseCount })
            : t('surveyEditor.deleteSurveyConfirm')
        }
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteSurveyMutation.isPending}
      />
      <ConfirmDialog
        isOpen={deleteQuestionTarget !== null}
        onClose={() => setDeleteQuestionTarget(null)}
        onConfirm={() => { if (deleteQuestionTarget) deleteQuestionMutation.mutate(deleteQuestionTarget.id) }}
        title={t('surveyEditor.deleteQuestionConfirm')}
        {...(deleteQuestionTarget?.textEn != null ? { message: deleteQuestionTarget.textEn } : {})}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteQuestionMutation.isPending}
      />
    </div>
  )
}
