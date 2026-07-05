import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, Edit2, Trash2, Settings, Globe, Archive } from 'lucide-react'
import type { CourseAdminResponse } from '@btec-lms/shared'
import {
  listAdminCourses,
  createAdminCourse,
  updateAdminCourse,
  updateCourseStatus,
  deleteAdminCourse,
} from '../../api/admin-courses.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

// ─── Query keys ──────────────────────────────────────────────────────────────

const courseListKey = (status: string, search: string) =>
  ['admin', 'courses', status, search] as const

// ─── Form schema ──────────────────────────────────────────────────────────────

const courseFormSchema = z.object({
  titleEn:         z.string().min(1).max(200),
  titleTh:         z.string().max(200).optional(),
  categoryEn:      z.string().min(1).max(100),
  categoryTh:      z.string().max(100).optional(),
  descriptionEn:   z.string().max(5000).optional(),
  descriptionTh:   z.string().max(5000).optional(),
  passScore:       z.coerce.number().int().min(0).max(100),
  expiryMonthsRaw: z.string().optional(),
  durationMinRaw:  z.string().optional(),
  allowSelfEnroll: z.boolean(),
})
type CourseFormValues = z.infer<typeof courseFormSchema>

// ─── Course form modal ────────────────────────────────────────────────────────

interface CourseFormModalProps {
  isOpen: boolean
  onClose: () => void
  editCourse?: CourseAdminResponse
}

function CourseFormModal({ isOpen, onClose, editCourse }: CourseFormModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CourseFormValues>({
    resolver: zodResolver(courseFormSchema),
    // defaultValues are set at mount time — parent uses key= to remount on course change
    defaultValues: editCourse ? {
      titleEn:         editCourse.titleEn,
      titleTh:         editCourse.titleTh ?? '',
      categoryEn:      editCourse.categoryEn,
      categoryTh:      editCourse.categoryTh ?? '',
      descriptionEn:   editCourse.descriptionEn ?? '',
      descriptionTh:   editCourse.descriptionTh ?? '',
      passScore:       editCourse.passScore,
      expiryMonthsRaw: editCourse.expiryMonths != null ? String(editCourse.expiryMonths) : '',
      durationMinRaw:  editCourse.durationMin != null ? String(editCourse.durationMin) : '',
      allowSelfEnroll: editCourse.allowSelfEnroll,
    } : {
      titleEn: '', titleTh: '', categoryEn: '', categoryTh: '',
      descriptionEn: '', descriptionTh: '',
      passScore: 80, expiryMonthsRaw: '', durationMinRaw: '',
      allowSelfEnroll: false,
    },
  })

  const buildApiBody = (values: CourseFormValues) => ({
    titleEn: values.titleEn,
    ...(values.titleTh?.trim() ? { titleTh: values.titleTh.trim() } : {}),
    categoryEn: values.categoryEn,
    ...(values.categoryTh?.trim() ? { categoryTh: values.categoryTh.trim() } : {}),
    ...(values.descriptionEn?.trim() ? { descriptionEn: values.descriptionEn.trim() } : {}),
    ...(values.descriptionTh?.trim() ? { descriptionTh: values.descriptionTh.trim() } : {}),
    passScore: values.passScore,
    expiryMonths: values.expiryMonthsRaw ? parseInt(values.expiryMonthsRaw) : null,
    durationMin: values.durationMinRaw ? parseInt(values.durationMinRaw) : undefined,
    allowSelfEnroll: values.allowSelfEnroll,
  })

  const onSubmit = async (values: CourseFormValues) => {
    try {
      const body = buildApiBody(values)
      if (editCourse) {
        await updateAdminCourse(editCourse.id, body)
        toast.success(t('adminCourse.courseUpdated'))
      } else {
        await createAdminCourse(body as Parameters<typeof createAdminCourse>[0])
        toast.success(t('adminCourse.courseCreated'))
      }
      await qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  const isArchived = editCourse?.status === 'ARCHIVED'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editCourse ? t('adminCourse.editCourse') : t('adminCourse.newCourse')}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Bilingual title */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={`${t('adminCourse.titleEn')} *`}
            error={errors.titleEn?.message}
            disabled={isArchived}
            {...register('titleEn')}
          />
          <Input
            label={t('adminCourse.titleTh')}
            disabled={isArchived}
            {...register('titleTh')}
          />
        </div>

        {/* Bilingual category */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={`${t('adminCourse.categoryEn')} *`}
            error={errors.categoryEn?.message}
            disabled={isArchived}
            {...register('categoryEn')}
          />
          <Input
            label={t('adminCourse.categoryTh')}
            disabled={isArchived}
            {...register('categoryTh')}
          />
        </div>

        {/* Bilingual description */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('adminCourse.descEn')}</label>
            <textarea
              rows={3}
              disabled={isArchived}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60"
              {...register('descriptionEn')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('adminCourse.descTh')}</label>
            <textarea
              rows={3}
              disabled={isArchived}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60"
              {...register('descriptionTh')}
            />
          </div>
        </div>

        {/* Numeric fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label={`${t('adminCourse.passScore')} (%)`}
            type="number"
            min={0}
            max={100}
            error={errors.passScore?.message}
            disabled={isArchived}
            {...register('passScore')}
          />
          <Input
            label={t('adminCourse.expiryMonths')}
            type="number"
            min={1}
            placeholder="—"
            disabled={isArchived}
            {...register('expiryMonthsRaw')}
          />
          <Input
            label={t('adminCourse.durationMin')}
            type="number"
            min={1}
            placeholder="—"
            disabled={isArchived}
            {...register('durationMinRaw')}
          />
        </div>

        {/* Self-enroll toggle */}
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            disabled={isArchived}
            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
            {...register('allowSelfEnroll')}
          />
          <span className="text-sm text-slate-700">{t('adminCourse.allowSelfEnroll')}</span>
        </label>

        {isArchived && (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
            {t('adminCourse.archivedReadOnly')}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {!isArchived && (
            <Button type="submit" isLoading={isSubmitting}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

// ─── CourseManagementPage ─────────────────────────────────────────────────────

export default function CourseManagementPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'

  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>('')
  const [formModal, setFormModal]     = useState<{ open: boolean; course?: CourseAdminResponse }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<CourseAdminResponse | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ course: CourseAdminResponse; next: 'PUBLISHED' | 'ARCHIVED' } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: courseListKey(statusFilter, search),
    queryFn: () =>
      listAdminCourses({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
        limit: 50,
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminCourse(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
      toast.success(t('adminCourse.courseDeleted'))
      setDeleteTarget(null)
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'PUBLISHED' | 'ARCHIVED' }) =>
      updateCourseStatus(id, next),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
      toast.success(
        vars.next === 'PUBLISHED' ? t('adminCourse.coursePublished') : t('adminCourse.courseArchived'),
      )
      setStatusTarget(null)
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  const columns = useMemo<Column<CourseAdminResponse>[]>(
    () => [
      {
        key: 'titleEn',
        header: t('adminCourse.titleEn'),
        skeleton: 'text-sub',
        render: (c) => (
          <div>
            <p className="font-medium text-slate-800">{c.titleEn}</p>
            {c.titleTh && <p className="text-xs text-slate-400">{c.titleTh}</p>}
          </div>
        ),
      },
      {
        key: 'categoryEn',
        header: t('course.category'),
        width: '14%',
        skeleton: 'text-sub',
        render: (c) => (
          <div>
            <p>{c.categoryEn}</p>
            {c.categoryTh && <p className="text-xs text-slate-400">{c.categoryTh}</p>}
          </div>
        ),
      },
      { key: 'status',    header: t('adminCourse.status'), width: '12%', skeleton: 'pill',
        render: (c) => <StatusBadge type="course" status={c.status} /> },
      { key: 'passScore', header: t('adminCourse.passScore'), width: '9%', align: 'right', skeleton: 'text',
        render: (c) => `${c.passScore}%` },
      {
        key: 'actions',
        header: '',
        width: '22%',
        align: 'right',
        skeleton: 'icons',
        render: (c) => (
          <div className="flex items-center justify-end gap-1">
            {/* Manage materials/quiz */}
            <Link to={`/admin/courses/${c.id}`}>
              <Button size="sm" variant="ghost" title={t('adminCourse.manageMaterials')}>
                <Settings size={14} />
              </Button>
            </Link>

            {/* Edit metadata */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFormModal({ open: true, course: c })}
              title={t('common.edit')}
            >
              <Edit2 size={14} />
            </Button>

            {/* Status change (ADMIN only) */}
            {isAdmin && c.status === 'DRAFT' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStatusTarget({ course: c, next: 'PUBLISHED' })}
              >
                <Globe size={13} />
                {t('adminCourse.publish')}
              </Button>
            )}
            {isAdmin && c.status === 'PUBLISHED' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStatusTarget({ course: c, next: 'ARCHIVED' })}
              >
                <Archive size={13} />
                {t('adminCourse.archive')}
              </Button>
            )}
            {c.status === 'ARCHIVED' && (
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-400">
                {t('adminCourse.archivedLabel')}
              </span>
            )}

            {/* Delete (ADMIN only) */}
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-600"
                onClick={() => setDeleteTarget(c)}
                title={t('common.delete')}
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t, isAdmin],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('adminCourse.title')}</h1>
        <Button leftIcon={<Plus size={16} />} onClick={() => setFormModal({ open: true })}>
          {t('adminCourse.newCourse')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('adminCourse.search')}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:w-auto"
        >
          <option value="">{t('adminCourse.allStatus')}</option>
          <option value="DRAFT">{t('course.status.DRAFT')}</option>
          <option value="PUBLISHED">{t('course.status.PUBLISHED')}</option>
          <option value="ARCHIVED">{t('course.status.ARCHIVED')}</option>
        </select>
      </div>

      {/* Error state */}
      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetch()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      {/* Table */}
      <DataTable<CourseAdminResponse>
        columns={columns}
        data={data?.data ?? []}
        keyField="id"
        isLoading={isLoading}
        emptyMessage={t('adminCourse.noCourses')}
      />

      {/* Course form modal — key forces remount so defaultValues are fresh on each open */}
      <CourseFormModal
        key={formModal.course?.id ?? 'new'}
        isOpen={formModal.open}
        onClose={() => setFormModal({ open: false })}
        {...(formModal.course !== undefined ? { editCourse: formModal.course } : {})}
      />

      {/* Status confirm */}
      <ConfirmDialog
        isOpen={statusTarget != null}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget)
            statusMutation.mutate({ id: statusTarget.course.id, next: statusTarget.next })
        }}
        title={statusTarget?.next === 'PUBLISHED' ? t('adminCourse.publishConfirm') : t('adminCourse.archiveConfirm')}
        message={`"${statusTarget?.course.titleEn}"`}
        confirmLabel={statusTarget?.next === 'PUBLISHED' ? t('adminCourse.publish') : t('adminCourse.archive')}
        isLoading={statusMutation.isPending}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
        title={t('adminCourse.deleteConfirm')}
        message={`"${deleteTarget?.titleEn}"`}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  )
}
