import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ChevronLeft, Plus, Trash2, Edit2, ArrowUp, ArrowDown,
  Link2, FileText, Video, Image, File, ExternalLink,
} from 'lucide-react'
import type { MaterialAdminResponse, MaterialType } from '@btec-lms/shared'
import { getAdminCourse } from '../../api/admin-courses.js'
import {
  listAdminMaterials,
  createLinkMaterial,
  updateMaterial,
  reorderMaterials,
  deleteMaterial,
  uploadFileMaterial,
} from '../../api/admin-materials.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { FileInput } from '../../components/ui/FileInput.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { Card } from '../../components/ui/Card.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import QuizEditorTab from './QuizEditorTab.js'
import SurveyEditorTab from './SurveyEditorTab.js'

// ─── Icons per material type ──────────────────────────────────────────────────

const TYPE_ICONS: Record<MaterialType, React.ReactNode> = {
  PDF:   <FileText size={16} className="text-red-500" />,
  VIDEO: <Video    size={16} className="text-purple-500" />,
  LINK:  <Link2   size={16} className="text-blue-500" />,
  IMAGE: <Image   size={16} className="text-emerald-500" />,
  DOC:   <File    size={16} className="text-amber-500" />,
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Add Link/Video modal ─────────────────────────────────────────────────────

const linkFormSchema = z.object({
  type:    z.enum(['VIDEO', 'LINK']),
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
  url:     z.string().url(),
})
type LinkFormValues = z.infer<typeof linkFormSchema>

interface AddLinkModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
}

function AddLinkModal({ isOpen, onClose, courseId }: AddLinkModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<LinkFormValues>({
      resolver: zodResolver(linkFormSchema),
      defaultValues: { type: 'LINK', titleEn: '', titleTh: '', url: '' },
    })

  const onSubmit = async (values: LinkFormValues) => {
    try {
      await createLinkMaterial(courseId, {
        type: values.type,
        titleEn: values.titleEn,
        ...(values.titleTh?.trim() ? { titleTh: values.titleTh.trim() } : {}),
        url: values.url,
      })
      toast.success(t('adminCourse.materialAdded'))
      await qc.invalidateQueries({ queryKey: ['admin', 'materials', courseId] })
      reset()
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('adminCourse.addLink')} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['LINK', 'VIDEO'] as const).map((tp) => (
            <label key={tp} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50">
              <input type="radio" value={tp} className="accent-brand-500" {...register('type')} />
              <span className="text-sm font-medium">{tp === 'LINK' ? t('material.types.LINK') : t('material.types.VIDEO')}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={`${t('adminCourse.titleEn')} *`} error={errors.titleEn?.message} {...register('titleEn')} />
          <Input label={t('adminCourse.titleTh')} {...register('titleTh')} />
        </div>
        <Input label={`URL *`} type="url" placeholder="https://" error={errors.url?.message} {...register('url')} />
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Add File modal (with XHR upload progress) ────────────────────────────────

const FILE_TYPES = ['PDF', 'IMAGE', 'DOC'] as const

interface AddFileModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
}

function AddFileModal({ isOpen, onClose, courseId }: AddFileModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [fileType, setFileType]     = useState<'PDF' | 'IMAGE' | 'DOC'>('PDF')
  const [titleEn, setTitleEn]       = useState('')
  const [titleTh, setTitleTh]       = useState('')
  const [file, setFile]             = useState<File | null>(null)
  const [progress, setProgress]     = useState<number | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFileType('PDF'); setTitleEn(''); setTitleTh(''); setFile(null); setProgress(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => { reset(); onClose() }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !titleEn.trim()) return
    setIsUploading(true)
    setProgress(0)

    // field ที่ไม่ใช่ file ต้องมาก่อน 'file' เสมอ — backend ใช้ req.file() (fastify-multipart)
    // ซึ่ง data.fields จะไม่ครบถ้า field มาหลัง part ของไฟล์ในสตรีม (ทำให้ type/titleEn เป็น undefined)
    const fd = new FormData()
    fd.append('type', fileType)
    fd.append('titleEn', titleEn.trim())
    if (titleTh.trim()) fd.append('titleTh', titleTh.trim())
    fd.append('file', file)

    try {
      await uploadFileMaterial(courseId, fd, setProgress)
      toast.success(t('adminCourse.materialAdded'))
      await qc.invalidateQueries({ queryKey: ['admin', 'materials', courseId] })
      reset()
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    } finally {
      setIsUploading(false)
      setProgress(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('adminCourse.addFile')} size="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* File type tabs */}
        <div className="flex gap-2">
          {FILE_TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setFileType(tp)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                fileType === tp
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {TYPE_ICONS[tp]}
              {t(`material.types.${tp}` as never) as string}
            </button>
          ))}
        </div>

        {/* Titles */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">{t('adminCourse.titleEn')} *</label>
            <input
              required
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">{t('adminCourse.titleTh')}</label>
            <input
              value={titleTh}
              onChange={(e) => setTitleTh(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        {/* File input */}
        <div>
          <label className="text-xs font-medium text-slate-700">{t('adminCourse.fileUpload')} *</label>
          <FileInput
            ref={fileRef}
            required
            accept={fileType === 'PDF' ? '.pdf' : fileType === 'IMAGE' ? '.jpg,.jpeg,.png,.gif,.webp' : '.doc,.docx,.xlsx,.xls,.ppt,.pptx'}
            file={file}
            onChange={setFile}
          />
          {file && (
            <p className="mt-1 text-xs text-slate-400">{formatBytes(file.size)}</p>
          )}
        </div>

        {/* Upload progress */}
        {progress !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{t('adminCourse.uploading')}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={handleClose} disabled={isUploading}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={isUploading} disabled={!file || !titleEn.trim()}>
            {t('adminCourse.upload')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Edit material modal ──────────────────────────────────────────────────────

const editFormSchema = z.object({
  titleEn: z.string().min(1).max(200),
  titleTh: z.string().max(200).optional(),
})
type EditFormValues = z.infer<typeof editFormSchema>

interface EditMaterialModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
  material: MaterialAdminResponse | null
}

function EditMaterialModal({ isOpen, onClose, courseId, material }: EditMaterialModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm<EditFormValues>({ resolver: zodResolver(editFormSchema) })

  // Pre-fill when material changes or modal opens
  useEffect(() => {
    if (isOpen && material) {
      reset({ titleEn: material.titleEn, titleTh: material.titleTh ?? '' })
    }
  }, [isOpen, material, reset])

  const onSubmit = async (values: EditFormValues) => {
    if (!material) return
    try {
      await updateMaterial(courseId, material.id, {
        titleEn: values.titleEn,
        ...(values.titleTh?.trim() ? { titleTh: values.titleTh.trim() } : { titleTh: null }),
      })
      toast.success(t('adminCourse.materialUpdated'))
      await qc.invalidateQueries({ queryKey: ['admin', 'materials', courseId] })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('adminCourse.editMaterial')}
      size="sm"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={`${t('adminCourse.titleEn')} *`} error={errors.titleEn?.message} {...register('titleEn')} />
          <Input label={t('adminCourse.titleTh')} {...register('titleTh')} />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Material row ─────────────────────────────────────────────────────────────

interface MaterialRowProps {
  material: MaterialAdminResponse
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
}

function MaterialRow({ material, index, total, onMoveUp, onMoveDown, onEdit, onDelete }: MaterialRowProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 hover:border-slate-200">
      {/* Order buttons */}
      <div className="flex flex-col">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30"
          title={t('common.moveUp')}
        >
          <ArrowUp size={13} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30"
          title={t('common.moveDown')}
        >
          <ArrowDown size={13} />
        </button>
      </div>

      {/* Icon */}
      <div className="shrink-0">{TYPE_ICONS[material.type]}</div>

      {/* Title */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{material.titleEn}</p>
        {material.titleTh && (
          <p className="truncate text-xs text-slate-400">{material.titleTh}</p>
        )}
        {material.sizeBytes != null && (
          <p className="text-xs text-slate-400">{formatBytes(material.sizeBytes)}</p>
        )}
      </div>

      {/* Type badge — ซ่อนบนจอแคบ เพราะไอคอนซ้ายมือสื่อความหมายซ้ำอยู่แล้ว และแถวนี้แน่นเกินไปบนมือถือ */}
      <span className="hidden shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500 sm:inline-block">
        {t(`material.types.${material.type}` as never) as string}
      </span>

      {/* Actions */}
      {material.url && (
        <a
          href={material.url}
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 hover:text-brand-500"
          title={t('common.open')}
        >
          <ExternalLink size={14} />
        </a>
      )}
      <Button size="sm" variant="ghost" onClick={onEdit} title={t('common.edit')}>
        <Edit2 size={13} />
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete} title={t('common.delete')}
        className="text-red-400 hover:text-red-600">
        <Trash2 size={13} />
      </Button>
    </div>
  )
}

// mirror ของ MaterialRow จริง — order buttons + icon + title/subtitle + type badge + action buttons
function MaterialRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-3" />
      </div>
      <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-4 w-14 rounded-md" />
      <Skeleton className="h-6 w-6 rounded" />
      <Skeleton className="h-6 w-6 rounded" />
    </div>
  )
}

// ─── CourseDetailAdminPage ────────────────────────────────────────────────────

type Tab = 'materials' | 'quiz' | 'survey'

export default function CourseDetailAdminPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('materials')
  const [addLinkOpen, setAddLinkOpen] = useState(false)
  const [addFileOpen, setAddFileOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<MaterialAdminResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MaterialAdminResponse | null>(null)

  const { data: course, isLoading: courseLoading } = useQuery({
    queryKey: ['admin', 'course', id],
    queryFn: () => getAdminCourse(id),
    enabled: !!id,
  })

  const { data: materials, isLoading: materialsLoading, isError: materialsError, refetch } =
    useQuery({
      queryKey: ['admin', 'materials', id],
      queryFn: () => listAdminMaterials(id),
      enabled: !!id,
      select: (list) => [...list].sort((a, b) => a.order - b.order),
    })

  const deleteMutation = useMutation({
    mutationFn: (matId: string) => deleteMaterial(id, matId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'materials', id] })
      toast.success(t('adminCourse.materialDeleted'))
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderMaterials(id, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'materials', id] }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (!materials) return
    const arr = materials.map((m) => m.id)
    const swapIdx = direction === 'up' ? index - 1 : index + 1
    ;[arr[index], arr[swapIdx]] = [arr[swapIdx]!, arr[index]!]
    reorderMutation.mutate(arr)
  }

  const isArchived = course?.status === 'ARCHIVED'

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/admin/courses" className="flex items-center gap-1 hover:text-brand-500">
          <ChevronLeft size={14} />
          {t('adminCourse.title')}
        </Link>
        <span>/</span>
        {courseLoading ? (
          <Skeleton className="h-3.5 w-32" />
        ) : (
          <span className="font-medium text-slate-700">{course?.titleEn}</span>
        )}
      </div>

      {/* Course header */}
      <Card>
        {courseLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-1/2" />
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ) : course ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold text-slate-800">{course.titleEn}</h1>
              {course.titleTh && <p className="break-words text-sm text-slate-400">{course.titleTh}</p>}
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                <span>{t('adminCourse.categoryEn')}: <strong className="text-slate-700">{course.categoryEn}</strong></span>
                {course.enrollmentCloseAt != null && (
                  <span>{t('adminCourse.enrollmentCloseAt')}: <strong className="text-slate-700">{new Date(course.enrollmentCloseAt).toLocaleDateString()}</strong></span>
                )}
              </div>
            </div>
            {isArchived && (
              <span className="shrink-0 self-start rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                {t('course.status.ARCHIVED')}
              </span>
            )}
          </div>
        ) : null}
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-100 bg-slate-50 p-1">
        {(['materials', 'quiz', 'survey'] as Tab[]).map((t2) => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t2
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t2 === 'materials' ? t('adminCourse.tabMaterials') : t2 === 'quiz' ? t('adminCourse.tabQuiz') : t('adminCourse.tabSurvey')}
          </button>
        ))}
      </div>

      {/* Materials tab */}
      {tab === 'materials' && (
        <div className="space-y-3">
          {/* Add buttons */}
          {!isArchived && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Plus size={13} />}
                onClick={() => setAddLinkOpen(true)}
              >
                {t('adminCourse.addLink')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Plus size={13} />}
                onClick={() => setAddFileOpen(true)}
              >
                {t('adminCourse.addFile')}
              </Button>
            </div>
          )}

          {/* Error */}
          {materialsError && (
            <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              <span>{t('common.error')}</span>
              <button onClick={() => void refetch()} className="font-medium underline">{t('common.retry')}</button>
            </div>
          )}

          {/* Materials list */}
          {materialsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <MaterialRowSkeleton key={i} />)}
            </div>
          ) : !materials?.length ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-400">
              {t('adminCourse.noMaterials')}
            </div>
          ) : (
            <div className="space-y-2">
              {materials.map((mat, idx) => (
                <MaterialRow
                  key={mat.id}
                  material={mat}
                  index={idx}
                  total={materials.length}
                  onMoveUp={() => handleMove(idx, 'up')}
                  onMoveDown={() => handleMove(idx, 'down')}
                  onEdit={() => setEditTarget(mat)}
                  onDelete={() => setDeleteTarget(mat)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quiz tab */}
      {tab === 'quiz' && <QuizEditorTab courseId={id} isArchived={isArchived} />}
      {tab === 'survey' && <SurveyEditorTab courseId={id} isArchived={isArchived} />}

      {/* Modals */}
      <AddLinkModal isOpen={addLinkOpen} onClose={() => setAddLinkOpen(false)} courseId={id} />
      <AddFileModal isOpen={addFileOpen} onClose={() => setAddFileOpen(false)} courseId={id} />
      <EditMaterialModal
        isOpen={editTarget !== null}
        onClose={() => setEditTarget(null)}
        courseId={id}
        material={editTarget}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
        title={t('adminCourse.deleteMaterialConfirm')}
        message={`"${deleteTarget?.titleEn}"`}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  )
}
