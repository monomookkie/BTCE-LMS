import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, Edit2, Trash2, Settings, Globe, Archive } from 'lucide-react'
import type { CourseAdminResponse, CourseAccessType } from '@btec-lms/shared'
import {
  listAdminCourses,
  createAdminCourse,
  updateAdminCourse,
  updateCourseStatus,
  deleteAdminCourse,
  setCoursePositions,
} from '../../api/admin-courses.js'
import { listAdminPositions } from '../../api/admin-positions.js'
import { courseHasActiveEnrollment } from '../../api/enrollments.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'
import { PAGE_SIZE } from '../../lib/constants.js'

// ─── Query keys ──────────────────────────────────────────────────────────────

const courseListKey = (status: string, search: string, page: number) =>
  ['admin', 'courses', status, search, page] as const

// ─── Form schema ──────────────────────────────────────────────────────────────

const courseFormSchema = z.object({
  titleEn:              z.string().min(1).max(200),
  titleTh:              z.string().max(200).optional(),
  categoryEn:           z.string().min(1).max(100),
  categoryTh:           z.string().max(100).optional(),
  descriptionEn:        z.string().max(5000).optional(),
  descriptionTh:        z.string().max(5000).optional(),
  enrollmentCloseAtRaw: z.string().optional(),
  paperSavingSheetsRaw: z.string().optional(),
  accessType:           z.enum(['PUBLIC', 'POSITION_BASED']),
})
type CourseFormValues = z.infer<typeof courseFormSchema>

// ─── Course form modal ────────────────────────────────────────────────────────

interface CourseFormModalProps {
  isOpen: boolean
  onClose: () => void
  editCourse?: CourseAdminResponse
}

function CourseFormModal({ isOpen, onClose, editCourse }: CourseFormModalProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const originalPositionIds = useMemo(
    () => (editCourse?.positions ?? []).map((p) => p.id),
    [editCourse],
  )
  const [selectedPositionIds, setSelectedPositionIds] = useState<string[]>(originalPositionIds)

  const { data: positions } = useQuery({
    queryKey: ['admin', 'positions', i18n.language],
    queryFn: listAdminPositions,
  })

  // accessType-lock: เช็คว่า course มี enrollment ที่ยัง active อยู่ไหมตอนเปิด edit modal —
  // ถ้ามี → disable accessType selector + บอกเหตุผล แทนที่จะปล่อยให้ submit แล้วเจอ 400 (UX แย่)
  const { data: hasActiveEnrollment } = useQuery({
    queryKey: ['admin', 'enrollments', 'has-active', editCourse?.id],
    queryFn: () => courseHasActiveEnrollment(editCourse!.id),
    enabled: editCourse != null,
  })
  const accessTypeLocked = editCourse != null && hasActiveEnrollment === true

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CourseFormValues>({
    resolver: zodResolver(courseFormSchema),
    // defaultValues are set at mount time — parent uses key= to remount on course change
    defaultValues: editCourse ? {
      titleEn:              editCourse.titleEn,
      titleTh:              editCourse.titleTh ?? '',
      categoryEn:           editCourse.categoryEn,
      categoryTh:           editCourse.categoryTh ?? '',
      descriptionEn:        editCourse.descriptionEn ?? '',
      descriptionTh:        editCourse.descriptionTh ?? '',
      enrollmentCloseAtRaw: editCourse.enrollmentCloseAt != null ? editCourse.enrollmentCloseAt.slice(0, 10) : '',
      paperSavingSheetsRaw: editCourse.paperSavingSheets != null ? String(editCourse.paperSavingSheets) : '',
      accessType:           editCourse.accessType,
    } : {
      titleEn: '', titleTh: '', categoryEn: '', categoryTh: '',
      descriptionEn: '', descriptionTh: '',
      enrollmentCloseAtRaw: '', paperSavingSheetsRaw: '',
      accessType: 'PUBLIC',
    },
  })

  const accessTypeValue = watch('accessType')

  const buildApiBody = (values: CourseFormValues) => ({
    titleEn: values.titleEn,
    ...(values.titleTh?.trim() ? { titleTh: values.titleTh.trim() } : {}),
    categoryEn: values.categoryEn,
    ...(values.categoryTh?.trim() ? { categoryTh: values.categoryTh.trim() } : {}),
    ...(values.descriptionEn?.trim() ? { descriptionEn: values.descriptionEn.trim() } : {}),
    ...(values.descriptionTh?.trim() ? { descriptionTh: values.descriptionTh.trim() } : {}),
    enrollmentCloseAt: values.enrollmentCloseAtRaw
      ? new Date(`${values.enrollmentCloseAtRaw}T23:59:59`).toISOString()
      : null,
    paperSavingSheets: values.paperSavingSheetsRaw ? parseInt(values.paperSavingSheetsRaw) : null,
  })

  const onSubmit = async (values: CourseFormValues) => {
    try {
      const body = buildApiBody(values)
      let courseId: string

      if (editCourse) {
        await updateAdminCourse(editCourse.id, { ...body, accessType: values.accessType })
        courseId = editCourse.id
        toast.success(t('adminCourse.courseUpdated'))
      } else {
        const created = await createAdminCourse({ ...body, accessType: values.accessType })
        courseId = created.id
        toast.success(t('adminCourse.courseCreated'))
      }

      // setCoursePositions ใช้ได้เฉพาะ course ที่ accessType เป็น POSITION_BASED เท่านั้น (backend gate)
      // ต้องเรียกหลัง accessType ถูกตั้งเป็น POSITION_BASED แล้วเท่านั้น (ลำดับสำคัญ) — ข้ามถ้าไม่ได้เลือก
      // POSITION_BASED หรือ list ไม่เปลี่ยนแปลงเลย (ลด request ที่ไม่จำเป็น)
      const positionsChanged =
        selectedPositionIds.length !== originalPositionIds.length ||
        selectedPositionIds.some((id) => !originalPositionIds.includes(id))
      if (values.accessType === 'POSITION_BASED' && positionsChanged) {
        await setCoursePositions(courseId, { positionIds: selectedPositionIds })
      }

      await qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  const isArchived = editCourse?.status === 'ARCHIVED'
  // course-position-removal-gate (backend, 2C-2): published + POSITION_BASED ต้องเหลือ position ≥1
  // เสมอ — UI ต้องกันการ uncheck ตัวสุดท้ายไว้ก่อน ไม่ใช่ปล่อยให้ยิงแล้วเจอ 400
  const isLastPositionLocked =
    editCourse?.status === 'PUBLISHED' &&
    accessTypeValue === 'POSITION_BASED' &&
    selectedPositionIds.length === 1

  const togglePosition = (id: string) => {
    setSelectedPositionIds((prev) => {
      if (prev.includes(id)) {
        if (isLastPositionLocked && prev.length === 1) return prev
        return prev.filter((p) => p !== id)
      }
      return [...prev, id]
    })
  }

  // เคลียร์ทั้งหมด — ถ้าติด course-position-removal-gate (published + ต้องเหลือ ≥1) ให้เหลือตัวแรกไว้
  // แทนที่จะเคลียร์จนหมด (พฤติกรรมเดียวกับ toggle ทีละอันที่ล็อกตัวสุดท้ายไว้)
  const clearPositions = () => {
    setSelectedPositionIds((prev) => {
      if (editCourse?.status === 'PUBLISHED' && accessTypeValue === 'POSITION_BASED' && prev.length > 0) {
        return [prev[0]] as string[]
      }
      return []
    })
  }

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

        {/* Numeric + date fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={t('adminCourse.enrollmentCloseAt')}
            type="date"
            disabled={isArchived}
            {...register('enrollmentCloseAtRaw')}
          />
          <Input
            label={t('adminCourse.paperSavingSheets')}
            type="number"
            min={1}
            placeholder="—"
            disabled={isArchived}
            {...register('paperSavingSheetsRaw')}
          />
        </div>

        {/* accessType (PUBLIC/POSITION_BASED) + position picker — 2C-5 */}
        <div className="space-y-1">
          <Controller
            name="accessType"
            control={control}
            render={({ field }) => (
              <Select
                label={t('adminCourse.accessType')}
                value={field.value}
                onChange={(v) => field.onChange(v as CourseAccessType)}
                disabled={isArchived || accessTypeLocked}
                options={[
                  { value: 'PUBLIC', label: t('adminCourse.accessTypePublic') },
                  { value: 'POSITION_BASED', label: t('adminCourse.accessTypePositionBased') },
                ]}
              />
            )}
          />
          {accessTypeLocked && (
            <p className="text-xs text-amber-600">{t('adminCourse.accessTypeLocked')}</p>
          )}
        </div>

        {accessTypeValue === 'POSITION_BASED' && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-slate-700">{t('adminCourse.positions')}</label>
              {selectedPositionIds.length > 0 && !isArchived && (
                <button
                  type="button"
                  onClick={clearPositions}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {t('adminCourse.clearPositions')}
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">{t('adminCourse.positionsHelp')}</p>
            {(positions ?? []).length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                {t('adminCourse.noPositionsAvailable')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                {(positions ?? []).map((p) => {
                  const checked = selectedPositionIds.includes(p.id)
                  const disableUncheck = isArchived || (checked && isLastPositionLocked)
                  return (
                    <label
                      key={p.id}
                      className={[
                        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
                        disableUncheck ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50',
                      ].join(' ')}
                      title={checked && isLastPositionLocked ? t('adminCourse.cannotUncheckLastPosition') : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disableUncheck}
                        onChange={() => togglePosition(p.id)}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-slate-700">{p.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

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
  const [page, setPage]               = useState(1)
  const [formModal, setFormModal]     = useState<{ open: boolean; course?: CourseAdminResponse }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<CourseAdminResponse | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ course: CourseAdminResponse; next: 'PUBLISHED' | 'ARCHIVED' } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: courseListKey(statusFilter, search, page),
    queryFn: () =>
      listAdminCourses({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search ? { search } : {}),
        page,
        limit: PAGE_SIZE,
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
        header: t('adminCourse.columnTitle'),
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
      { key: 'enrollmentCloseAt', header: t('adminCourse.enrollmentCloseAt'), width: '13%', skeleton: 'text',
        render: (c) => c.enrollmentCloseAt ? new Date(c.enrollmentCloseAt).toLocaleDateString() : '—' },
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
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder={t('adminCourse.search')}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <Select
          className="sm:w-auto"
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(1) }}
          options={[
            { value: '', label: t('adminCourse.allStatus') },
            { value: 'DRAFT', label: t('course.status.DRAFT') },
            { value: 'PUBLISHED', label: t('course.status.PUBLISHED') },
            { value: 'ARCHIVED', label: t('course.status.ARCHIVED') },
          ]}
        />
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
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: setPage,
        }}
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
