import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Edit2, ArrowUp, ArrowDown, CheckCircle2, Circle } from 'lucide-react'
import type { QuizAdminResponse } from '@btec-lms/shared'
import {
  getAdminQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  addOption,
  updateOption,
  deleteOption,
} from '../../api/admin-quizzes.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { Card } from '../../components/ui/Card.js'
import { Skeleton } from '../../components/ui/Skeleton.js'

type QuizQuestion = QuizAdminResponse['questions'][number]
type QuizOption = QuizQuestion['options'][number]

// ─── Quiz settings modal (create + edit) ──────────────────────────────────────

const quizSettingsSchema = z.object({
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
  passRequiredCount: z.coerce.number().int().min(0),
  maxAttemptsRaw: z.string(),
  shuffle: z.boolean(),
})
type QuizSettingsValues = z.infer<typeof quizSettingsSchema>

interface QuizSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
  quiz: QuizAdminResponse | null
}

function QuizSettingsModal({ isOpen, onClose, courseId, quiz }: QuizSettingsModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<QuizSettingsValues>({
      resolver: zodResolver(quizSettingsSchema),
      defaultValues: quiz
        ? {
            titleEn: quiz.titleEn,
            titleTh: quiz.titleTh ?? '',
            passRequiredCount: quiz.passRequiredCount,
            maxAttemptsRaw: quiz.maxAttempts != null ? String(quiz.maxAttempts) : '',
            shuffle: quiz.shuffle,
          }
        : { titleEn: '', titleTh: '', passRequiredCount: 1, maxAttemptsRaw: '', shuffle: true },
    })

  const onSubmit = async (values: QuizSettingsValues) => {
    const maxAttempts = values.maxAttemptsRaw.trim() ? Number(values.maxAttemptsRaw.trim()) : null
    const body = {
      titleEn: values.titleEn,
      ...(values.titleTh?.trim() ? { titleTh: values.titleTh.trim() } : {}),
      passRequiredCount: values.passRequiredCount,
      maxAttempts,
      shuffle: values.shuffle,
    }
    try {
      const updated = quiz ? await updateQuiz(courseId, body) : await createQuiz(courseId, body)
      qc.setQueryData(['admin', 'quiz', courseId], updated)
      toast.success(quiz ? t('quizEditor.quizUpdated') : t('quizEditor.quizCreated'))
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={quiz ? t('quizEditor.editQuiz') : t('quizEditor.createQuiz')} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={`${t('quizEditor.quizTitleEn')} *`} error={errors.titleEn?.message} {...register('titleEn')} />
          <Input label={t('quizEditor.quizTitleTh')} {...register('titleTh')} />
        </div>
        <Input
          label={
            quiz && quiz.questions.length > 0
              ? `${t('quizEditor.passRequiredCount')} (${t('quizEditor.outOfQuestions', { count: quiz.questions.length })})`
              : t('quizEditor.passRequiredCount')
          }
          type="number"
          min={0}
          max={quiz && quiz.questions.length > 0 ? quiz.questions.length : undefined}
          helperText={!quiz || quiz.questions.length === 0 ? t('quizEditor.passRequiredCountHelpNoQuestions') : undefined}
          error={errors.passRequiredCount?.message}
          {...register('passRequiredCount')}
        />
        <Input
          label={t('quizEditor.maxAttempts')}
          type="number"
          min={1}
          placeholder={t('quizEditor.maxAttemptsHelp')}
          helperText={t('quizEditor.maxAttemptsHelp')}
          {...register('maxAttemptsRaw')}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="accent-brand-500" {...register('shuffle')} />
          {t('quizEditor.shuffle')}
        </label>
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Add Question modal (question text + options + single correct answer) ────

const questionFormSchema = z.object({
  textEn: z.string().min(1).max(2000),
  textTh: z.string().max(2000).optional(),
  options: z
    .array(z.object({ textEn: z.string().min(1).max(500), textTh: z.string().max(500).optional() }))
    .min(2)
    .max(10),
})
type QuestionFormValues = z.infer<typeof questionFormSchema>

interface AddQuestionModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
}

function AddQuestionModal({ isOpen, onClose, courseId }: AddQuestionModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [correctIndex, setCorrectIndex] = useState(0)

  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<QuestionFormValues>({
      resolver: zodResolver(questionFormSchema),
      defaultValues: { textEn: '', textTh: '', options: [{ textEn: '', textTh: '' }, { textEn: '', textTh: '' }] },
    })
  const { fields, append, remove } = useFieldArray({ control, name: 'options' })

  const handleClose = () => {
    reset({ textEn: '', textTh: '', options: [{ textEn: '', textTh: '' }, { textEn: '', textTh: '' }] })
    setCorrectIndex(0)
    onClose()
  }

  const handleRemove = (index: number) => {
    remove(index)
    setCorrectIndex((prev) => {
      if (index === prev) return 0
      if (index < prev) return prev - 1
      return prev
    })
  }

  const onSubmit = async (values: QuestionFormValues) => {
    try {
      const updated = await addQuestion(courseId, {
        textEn: values.textEn,
        ...(values.textTh?.trim() ? { textTh: values.textTh.trim() } : {}),
        options: values.options.map((o, i) => ({
          textEn: o.textEn,
          ...(o.textTh?.trim() ? { textTh: o.textTh.trim() } : {}),
          isCorrect: i === correctIndex,
        })),
      })
      qc.setQueryData(['admin', 'quiz', courseId], updated)
      toast.success(t('quizEditor.questionAdded'))
      handleClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('quizEditor.addQuestion')} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={`${t('quizEditor.questionTextEn')} *`} error={errors.textEn?.message} {...register('textEn')} />
          <Input label={t('quizEditor.questionTextTh')} {...register('textTh')} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{t('quizEditor.options')}</span>
            <span className="text-xs text-slate-400">{t('quizEditor.atLeastOneCorrect')}</span>
          </div>
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2 rounded-xl border border-slate-100 p-3">
              <button
                type="button"
                onClick={() => setCorrectIndex(index)}
                title={t('quizEditor.markCorrect')}
                className={`mt-2 shrink-0 ${correctIndex === index ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-500'}`}
              >
                {correctIndex === index ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </button>
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  placeholder={`${t('quizEditor.optionTextEn')} *`}
                  error={errors.options?.[index]?.textEn?.message}
                  {...register(`options.${index}.textEn` as const)}
                />
                <Input
                  placeholder={t('quizEditor.optionTextTh')}
                  {...register(`options.${index}.textTh` as const)}
                />
              </div>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                disabled={fields.length <= 2}
                title={fields.length <= 2 ? t('quizEditor.minOptionsReached') : t('common.delete')}
                className="mt-2 shrink-0 text-slate-300 hover:text-red-500 disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            leftIcon={<Plus size={13} />}
            disabled={fields.length >= 10}
            onClick={() => append({ textEn: '', textTh: '' })}
          >
            {fields.length >= 10 ? t('quizEditor.maxOptionsReached') : t('quizEditor.addOption')}
          </Button>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit question text modal ─────────────────────────────────────────────────

const questionTextSchema = z.object({
  textEn: z.string().min(1).max(2000),
  textTh: z.string().max(2000).optional(),
})
type QuestionTextValues = z.infer<typeof questionTextSchema>

interface EditQuestionModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
  question: QuizQuestion | null
}

function EditQuestionModal({ isOpen, onClose, courseId, question }: EditQuestionModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<QuestionTextValues>({
      resolver: zodResolver(questionTextSchema),
      values: question ? { textEn: question.textEn, textTh: question.textTh ?? '' } : { textEn: '', textTh: '' },
    })

  const onSubmit = async (values: QuestionTextValues) => {
    if (!question) return
    try {
      const updated = await updateQuestion(courseId, question.id, {
        textEn: values.textEn,
        ...(values.textTh?.trim() ? { textTh: values.textTh.trim() } : { textTh: null }),
      })
      qc.setQueryData(['admin', 'quiz', courseId], updated)
      toast.success(t('quizEditor.questionUpdated'))
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('quizEditor.editQuestionText')} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={`${t('quizEditor.questionTextEn')} *`} error={errors.textEn?.message} {...register('textEn')} />
        <Input label={t('quizEditor.questionTextTh')} {...register('textTh')} />
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit option text modal ───────────────────────────────────────────────────

interface EditOptionModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
  questionId: string | null
  option: QuizOption | null
}

function EditOptionModal({ isOpen, onClose, courseId, questionId, option }: EditOptionModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<QuestionTextValues>({
      resolver: zodResolver(questionTextSchema),
      values: option ? { textEn: option.textEn, textTh: option.textTh ?? '' } : { textEn: '', textTh: '' },
    })

  const onSubmit = async (values: QuestionTextValues) => {
    if (!questionId || !option) return
    try {
      const updated = await updateOption(courseId, questionId, option.id, {
        textEn: values.textEn,
        ...(values.textTh?.trim() ? { textTh: values.textTh.trim() } : { textTh: null }),
      })
      qc.setQueryData(['admin', 'quiz', courseId], updated)
      toast.success(t('quizEditor.optionUpdated'))
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('quizEditor.editOption')} size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={`${t('quizEditor.optionTextEn')} *`} error={errors.textEn?.message} {...register('textEn')} />
        <Input label={t('quizEditor.optionTextTh')} {...register('textTh')} />
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Add option inline row ─────────────────────────────────────────────────────

interface AddOptionRowProps {
  courseId: string
  questionId: string
  disabled: boolean
}

function AddOptionRow({ courseId, questionId, disabled }: AddOptionRowProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [textEn, setTextEn] = useState('')
  const [textTh, setTextTh] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      addOption(courseId, questionId, {
        textEn: textEn.trim(),
        ...(textTh.trim() ? { textTh: textTh.trim() } : {}),
        isCorrect: false,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['admin', 'quiz', courseId], updated)
      toast.success(t('quizEditor.optionAdded'))
      setTextEn(''); setTextTh(''); setOpen(false)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        leftIcon={<Plus size={13} />}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {disabled ? t('quizEditor.maxOptionsReached') : t('quizEditor.addOption')}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-100 p-2 sm:flex-row sm:items-center">
      <input
        autoFocus
        value={textEn}
        onChange={(e) => setTextEn(e.target.value)}
        placeholder={`${t('quizEditor.optionTextEn')} *`}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
      />
      <input
        value={textTh}
        onChange={(e) => setTextTh(e.target.value)}
        placeholder={t('quizEditor.optionTextTh')}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none"
      />
      <div className="flex shrink-0 justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button
          size="sm"
          type="button"
          isLoading={mutation.isPending}
          disabled={!textEn.trim()}
          onClick={() => mutation.mutate()}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

// ─── Question card ──────────────────────────────────────────────────────────

interface QuestionCardProps {
  courseId: string
  question: QuizQuestion
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onEditText: () => void
  onDeleteQuestion: () => void
  onEditOption: (option: QuizOption) => void
  onDeleteOption: (option: QuizOption) => void
}

function QuestionCard({
  courseId, question, index, total, onMoveUp, onMoveDown, onEditText, onDeleteQuestion, onEditOption, onDeleteOption,
}: QuestionCardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const setCorrectMutation = useMutation({
    mutationFn: async (optionId: string) => {
      const current = question.options.find((o) => o.isCorrect && o.id !== optionId)
      if (current) {
        await updateOption(courseId, question.id, current.id, { isCorrect: false })
      }
      return updateOption(courseId, question.id, optionId, { isCorrect: true })
    },
    onSuccess: (updated) => qc.setQueryData(['admin', 'quiz', courseId], updated),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  return (
    <Card noPadding className="overflow-visible">
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
          <p className="text-sm font-medium text-slate-800">{index + 1}. {question.textEn}</p>
          {question.textTh && <p className="text-xs text-slate-400">{question.textTh}</p>}

          <div className="mt-3 space-y-1.5">
            {question.options.map((opt) => (
              <div key={opt.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <button
                  type="button"
                  onClick={() => !opt.isCorrect && setCorrectMutation.mutate(opt.id)}
                  disabled={setCorrectMutation.isPending}
                  title={opt.isCorrect ? t('quizEditor.correctAnswer') : t('quizEditor.markCorrect')}
                  className={opt.isCorrect ? 'text-emerald-500' : 'text-slate-300 hover:text-slate-500'}
                >
                  {opt.isCorrect ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                </button>
                <div className="min-w-0 flex-1 text-sm text-slate-700">
                  {opt.textEn}
                  {opt.textTh && <span className="ml-2 text-xs text-slate-400">{opt.textTh}</span>}
                </div>
                <button onClick={() => onEditOption(opt)} title={t('quizEditor.editOption')} className="text-slate-300 hover:text-slate-600">
                  <Edit2 size={13} />
                </button>
                <button
                  onClick={() => onDeleteOption(opt)}
                  disabled={question.options.length <= 2}
                  title={question.options.length <= 2 ? t('quizEditor.minOptionsReached') : t('common.delete')}
                  className="text-slate-300 hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <AddOptionRow courseId={courseId} questionId={question.id} disabled={question.options.length >= 10} />
          </div>
        </div>

        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onEditText} title={t('common.edit')}>
            <Edit2 size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDeleteQuestion} title={t('common.delete')} className="text-red-400 hover:text-red-600">
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

// mirror ของ quiz settings card จริง — title+subtitle บรรทัดบน, meta 2 รายการ, ปุ่มขวา
function QuizSettingsCardSkeleton() {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4.5 w-40" />
          <div className="flex gap-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-16 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg" />
        </div>
      </div>
    </Card>
  )
}

// mirror ของ QuestionCard จริง — order buttons + question title + N option rows + action buttons
function QuestionCardSkeleton() {
  return (
    <Card noPadding>
      <div className="flex items-start gap-3 p-4">
        <div className="flex flex-col gap-1 pt-1">
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-6 w-6 rounded" />
        </div>
      </div>
    </Card>
  )
}

// ─── QuizEditorTab ──────────────────────────────────────────────────────────

interface QuizEditorTabProps {
  courseId: string
  isArchived: boolean
}

export default function QuizEditorTab({ courseId, isArchived }: QuizEditorTabProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteQuizOpen, setDeleteQuizOpen] = useState(false)
  const [addQuestionOpen, setAddQuestionOpen] = useState(false)
  const [editQuestion, setEditQuestion] = useState<QuizQuestion | null>(null)
  const [deleteQuestionTarget, setDeleteQuestionTarget] = useState<QuizQuestion | null>(null)
  const [editOptionTarget, setEditOptionTarget] = useState<{ questionId: string; option: QuizOption } | null>(null)
  const [deleteOptionTarget, setDeleteOptionTarget] = useState<{ questionId: string; option: QuizOption } | null>(null)

  const { data: quiz, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'quiz', courseId],
    queryFn: () => getAdminQuiz(courseId),
    enabled: !!courseId,
    retry: false,
  })
  const quizNotFound = isError && error instanceof ApiError && error.status === 404

  const reorderQuestionMutation = useMutation({
    mutationFn: async ({ aId, aOrder, bId, bOrder }: { aId: string; aOrder: number; bId: string; bOrder: number }) => {
      await updateQuestion(courseId, aId, { order: bOrder })
      return updateQuestion(courseId, bId, { order: aOrder })
    },
    onSuccess: (updated) => qc.setQueryData(['admin', 'quiz', courseId], updated),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const deleteQuizMutation = useMutation({
    mutationFn: () => deleteQuiz(courseId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['admin', 'quiz', courseId] })
      toast.success(t('quizEditor.quizDeleted'))
      setDeleteQuizOpen(false)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const deleteQuestionMutation = useMutation({
    mutationFn: (questionId: string) => deleteQuestion(courseId, questionId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'quiz', courseId] })
      toast.success(t('quizEditor.questionDeleted'))
      setDeleteQuestionTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const deleteOptionMutation = useMutation({
    mutationFn: ({ questionId, optionId }: { questionId: string; optionId: string }) =>
      deleteOption(courseId, questionId, optionId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'quiz', courseId] })
      toast.success(t('quizEditor.optionDeleted'))
      setDeleteOptionTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    if (!quiz) return
    const questions = [...quiz.questions].sort((a, b) => a.order - b.order)
    const swapIdx = direction === 'up' ? index - 1 : index + 1
    const a = questions[index]
    const b = questions[swapIdx]
    if (!a || !b) return
    reorderQuestionMutation.mutate({ aId: a.id, aOrder: a.order, bId: b.id, bOrder: b.order })
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <QuizSettingsCardSkeleton />
        <Skeleton className="h-4 w-28" />
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <QuestionCardSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  if (isError && !quizNotFound) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
        <span>{t('common.error')}</span>
        <button onClick={() => void refetch()} className="font-medium underline">{t('common.retry')}</button>
      </div>
    )
  }

  if (quizNotFound || !quiz) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center">
        <p className="mb-4 text-sm font-medium text-slate-500">{t('quizEditor.noQuiz')}</p>
        {!isArchived && (
          <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => setSettingsOpen(true)}>
            {t('quizEditor.createQuiz')}
          </Button>
        )}
        <QuizSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} courseId={courseId} quiz={null} />
      </div>
    )
  }

  const sortedQuestions = [...quiz.questions].sort((a, b) => a.order - b.order)

  return (
    <div className="space-y-4">
      {/* Quiz settings */}
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">{quiz.titleEn}</h3>
            {quiz.titleTh && <p className="text-sm text-slate-400">{quiz.titleTh}</p>}
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span>{t('quizEditor.passRequiredCount')}: <strong className="text-slate-700">{quiz.passRequiredCount}/{quiz.questions.length}</strong></span>
              <span>{t('quizEditor.maxAttempts')}: <strong className="text-slate-700">{quiz.maxAttempts ?? '∞'}</strong></span>
              <span>{t('quizEditor.shuffle')}: <strong className="text-slate-700">{quiz.shuffle ? t('common.yes') : t('common.no')}</strong></span>
            </div>
          </div>
          {!isArchived && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" leftIcon={<Edit2 size={13} />} onClick={() => setSettingsOpen(true)}>
                {t('common.edit')}
              </Button>
              <Button size="sm" variant="danger" leftIcon={<Trash2 size={13} />} onClick={() => setDeleteQuizOpen(true)}>
                {t('quizEditor.deleteQuiz')}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Questions */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">{t('quizEditor.questions')}</h4>
        {!isArchived && (
          <Button size="sm" variant="outline" leftIcon={<Plus size={13} />} onClick={() => setAddQuestionOpen(true)}>
            {t('quizEditor.addQuestion')}
          </Button>
        )}
      </div>

      {sortedQuestions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
          {t('quizEditor.noQuestions')}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedQuestions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              courseId={courseId}
              question={q}
              index={idx}
              total={sortedQuestions.length}
              onMoveUp={() => handleMoveQuestion(idx, 'up')}
              onMoveDown={() => handleMoveQuestion(idx, 'down')}
              onEditText={() => setEditQuestion(q)}
              onDeleteQuestion={() => setDeleteQuestionTarget(q)}
              onEditOption={(option) => setEditOptionTarget({ questionId: q.id, option })}
              onDeleteOption={(option) => setDeleteOptionTarget({ questionId: q.id, option })}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <QuizSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} courseId={courseId} quiz={quiz} />
      <AddQuestionModal isOpen={addQuestionOpen} onClose={() => setAddQuestionOpen(false)} courseId={courseId} />
      <EditQuestionModal
        isOpen={editQuestion !== null}
        onClose={() => setEditQuestion(null)}
        courseId={courseId}
        question={editQuestion}
      />
      <EditOptionModal
        isOpen={editOptionTarget !== null}
        onClose={() => setEditOptionTarget(null)}
        courseId={courseId}
        questionId={editOptionTarget?.questionId ?? null}
        option={editOptionTarget?.option ?? null}
      />

      <ConfirmDialog
        isOpen={deleteQuizOpen}
        onClose={() => setDeleteQuizOpen(false)}
        onConfirm={() => deleteQuizMutation.mutate()}
        title={t('quizEditor.deleteQuiz')}
        message={t('quizEditor.deleteQuizConfirm')}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteQuizMutation.isPending}
      />
      <ConfirmDialog
        isOpen={deleteQuestionTarget !== null}
        onClose={() => setDeleteQuestionTarget(null)}
        onConfirm={() => { if (deleteQuestionTarget) deleteQuestionMutation.mutate(deleteQuestionTarget.id) }}
        title={t('quizEditor.deleteQuestionConfirm')}
        {...(deleteQuestionTarget?.textEn != null ? { message: deleteQuestionTarget.textEn } : {})}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteQuestionMutation.isPending}
      />
      <ConfirmDialog
        isOpen={deleteOptionTarget !== null}
        onClose={() => setDeleteOptionTarget(null)}
        onConfirm={() => {
          if (deleteOptionTarget) {
            deleteOptionMutation.mutate({ questionId: deleteOptionTarget.questionId, optionId: deleteOptionTarget.option.id })
          }
        }}
        title={t('quizEditor.deleteOptionConfirm')}
        {...(deleteOptionTarget?.option.textEn != null ? { message: deleteOptionTarget.option.textEn } : {})}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteOptionMutation.isPending}
      />
    </div>
  )
}
