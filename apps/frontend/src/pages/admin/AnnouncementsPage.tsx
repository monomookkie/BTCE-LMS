import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Edit2, Trash2, Globe, EyeOff } from 'lucide-react'
import type { AnnouncementAdminResponse, AnnouncementType } from '@btec-lms/shared'
import {
  listAdminAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../../api/admin-announcements.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { FileInput } from '../../components/ui/FileInput.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'
import { PAGE_SIZE } from '../../lib/constants.js'

const TYPES: AnnouncementType[] = ['INFO', 'WARNING', 'URGENT']
const ALLOWED_FILE_MIME = ['image/jpeg', 'image/png', 'image/webp']

// ─── Form schema ──────────────────────────────────────────────────────────────
// contentEn: "ข้อความเพิ่มเติม" ไม่บังคับ — รูปภาพคือเนื้อหาหลักของประกาศตอนนี้

const announcementFormSchema = z.object({
  titleEn: z.string().min(1).max(255),
  titleTh: z.string().max(255).optional(),
  contentEn: z.string().optional(),
  contentTh: z.string().optional(),
  type: z.enum(['INFO', 'WARNING', 'URGENT']),
  link: z.string().max(500).optional(),
})
type AnnouncementFormValues = z.infer<typeof announcementFormSchema>

// ─── Form modal ───────────────────────────────────────────────────────────────

interface FormModalProps {
  isOpen: boolean
  onClose: () => void
  editAnnouncement?: AnnouncementAdminResponse
}

function AnnouncementFormModal({ isOpen, onClose, editAnnouncement }: FormModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: editAnnouncement ? {
      titleEn: editAnnouncement.titleEn,
      titleTh: editAnnouncement.titleTh ?? '',
      contentEn: editAnnouncement.contentEn ?? '',
      contentTh: editAnnouncement.contentTh ?? '',
      type: editAnnouncement.type as AnnouncementType,
      link: editAnnouncement.link ?? '',
    } : {
      titleEn: '', titleTh: '', contentEn: '', contentTh: '', type: 'INFO', link: '',
    },
  })

  const handleFileChange = (f: File | null) => {
    if (f && !ALLOWED_FILE_MIME.includes(f.type)) {
      setFileError(t('adminAnnouncement.fileTypeError'))
      setFile(null)
      return
    }
    setFileError('')
    setFile(f)
  }

  const onSubmit = async (values: AnnouncementFormValues, status: 'DRAFT' | 'PUBLISHED') => {
    // สร้างใหม่ต้องมีรูปเสมอ (ไม่ใช่แค่ตอน publish) — เพราะ PATCH แนบไฟล์เพิ่มทีหลังไม่ได้
    // ถ้าปล่อยให้สร้างแบบไม่มีรูปได้ จะกลายเป็น draft ที่ publish ไม่ได้ตลอดกาล
    if (!editAnnouncement && !file) {
      setFileError(t('adminAnnouncement.fileRequired'))
      return
    }
    try {
      if (editAnnouncement) {
        // PATCH — file replacement not supported by backend; text/status fields only
        await updateAnnouncement(editAnnouncement.id, {
          titleEn: values.titleEn,
          titleTh: values.titleTh?.trim() ? values.titleTh.trim() : null,
          contentEn: values.contentEn?.trim() ? values.contentEn.trim() : null,
          contentTh: values.contentTh?.trim() ? values.contentTh.trim() : null,
          type: values.type,
          link: values.link?.trim() ? values.link.trim() : null,
        })
        toast.success(t('adminAnnouncement.announcementUpdated'))
      } else {
        const formData = new FormData()
        formData.set('titleEn', values.titleEn)
        if (values.titleTh?.trim()) formData.set('titleTh', values.titleTh.trim())
        if (values.contentEn?.trim()) formData.set('contentEn', values.contentEn.trim())
        if (values.contentTh?.trim()) formData.set('contentTh', values.contentTh.trim())
        formData.set('type', values.type)
        if (values.link?.trim()) formData.set('link', values.link.trim())
        formData.set('status', status)
        if (file) formData.set('file', file)
        await createAnnouncement(formData)
        toast.success(t('adminAnnouncement.announcementCreated'))
      }
      await qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
      setFile(null)
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editAnnouncement ? t('adminAnnouncement.editAnnouncement') : t('adminAnnouncement.newAnnouncement')}
      size="lg"
    >
      <form onSubmit={handleSubmit((v) => onSubmit(v, editAnnouncement?.status ?? 'DRAFT'))} className="space-y-5">
        {editAnnouncement ? (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
            {t('adminAnnouncement.fileEditNote')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('adminAnnouncement.file')} *</label>
            <FileInput accept={ALLOWED_FILE_MIME.join(',')} file={file} onChange={handleFileChange} />
            {fileError && <p className="text-xs text-red-500">{fileError}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={`${t('adminAnnouncement.titleEn')} *`}
            error={errors.titleEn?.message}
            {...register('titleEn')}
          />
          <Input label={t('adminAnnouncement.titleTh')} {...register('titleTh')} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('adminAnnouncement.contentEn')}</label>
            <textarea
              rows={3}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              {...register('contentEn')}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">{t('adminAnnouncement.contentTh')}</label>
            <textarea
              rows={3}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              {...register('contentTh')}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <Select
                label={t('adminAnnouncement.type')}
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'INFO', label: t('adminAnnouncement.typeInfo') },
                  { value: 'WARNING', label: t('adminAnnouncement.typeWarning') },
                  { value: 'URGENT', label: t('adminAnnouncement.typeUrgent') },
                ]}
              />
            )}
          />
          <Input label={t('adminAnnouncement.link')} placeholder="https://..." {...register('link')} />
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── AnnouncementsPage ─────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [page, setPage] = useState(1)
  const [formModal, setFormModal] = useState<{ open: boolean; announcement?: AnnouncementAdminResponse }>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementAdminResponse | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ announcement: AnnouncementAdminResponse; next: 'DRAFT' | 'PUBLISHED' } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'announcements', page],
    queryFn: () => listAdminAnnouncements({ page, limit: PAGE_SIZE }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAnnouncement(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
      toast.success(t('adminAnnouncement.announcementDeleted'))
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'DRAFT' | 'PUBLISHED' }) =>
      updateAnnouncement(id, { status: next }),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })
      toast.success(
        vars.next === 'PUBLISHED'
          ? t('adminAnnouncement.announcementPublished')
          : t('adminAnnouncement.announcementUnpublished'),
      )
      setStatusTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const columns = useMemo<Column<AnnouncementAdminResponse>[]>(
    () => [
      {
        key: 'titleEn',
        header: t('adminAnnouncement.columnTitle'),
        skeleton: 'text-sub',
        render: (a) => (
          <div>
            <p className="font-medium text-slate-800">{a.titleEn}</p>
            {a.titleTh && <p className="text-xs text-slate-400">{a.titleTh}</p>}
          </div>
        ),
      },
      { key: 'type', header: t('adminAnnouncement.type'), width: '12%', skeleton: 'text' },
      { key: 'status', header: t('adminCourse.status'), width: '12%', skeleton: 'pill',
        render: (a) => <StatusBadge type="announcement" status={a.status} /> },
      { key: 'createdAt', header: t('adminAnnouncement.createdAt'), width: '14%', skeleton: 'text',
        render: (a) => new Date(a.createdAt).toLocaleDateString() },
      {
        key: 'actions',
        header: '',
        width: '22%',
        align: 'right',
        skeleton: 'icons',
        render: (a) => (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setFormModal({ open: true, announcement: a })} title={t('common.edit')}>
              <Edit2 size={14} />
            </Button>
            {a.status === 'DRAFT' ? (
              <Button size="sm" variant="outline" onClick={() => setStatusTarget({ announcement: a, next: 'PUBLISHED' })}>
                <Globe size={13} />
                {t('adminAnnouncement.publish')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setStatusTarget({ announcement: a, next: 'DRAFT' })}>
                <EyeOff size={13} />
                {t('adminAnnouncement.unpublish')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-red-400 hover:text-red-600"
              onClick={() => setDeleteTarget(a)}
              title={t('common.delete')}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ),
      },
    ],
    [t],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('adminAnnouncement.title')}</h1>
        <Button leftIcon={<Plus size={16} />} onClick={() => setFormModal({ open: true })}>
          {t('adminAnnouncement.newAnnouncement')}
        </Button>
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetch()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      <DataTable<AnnouncementAdminResponse>
        columns={columns}
        data={data?.data ?? []}
        keyField="id"
        isLoading={isLoading}
        emptyMessage={t('adminAnnouncement.noAnnouncements')}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: setPage,
        }}
      />

      <AnnouncementFormModal
        key={formModal.announcement?.id ?? 'new'}
        isOpen={formModal.open}
        onClose={() => setFormModal({ open: false })}
        {...(formModal.announcement !== undefined ? { editAnnouncement: formModal.announcement } : {})}
      />

      <ConfirmDialog
        isOpen={statusTarget != null}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget) statusMutation.mutate({ id: statusTarget.announcement.id, next: statusTarget.next })
        }}
        title={statusTarget?.next === 'PUBLISHED' ? t('adminAnnouncement.publishConfirm') : t('adminAnnouncement.unpublishConfirm')}
        message={`"${statusTarget?.announcement.titleEn}"`}
        confirmLabel={statusTarget?.next === 'PUBLISHED' ? t('adminAnnouncement.publish') : t('adminAnnouncement.unpublish')}
        isLoading={statusMutation.isPending}
      />

      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
        title={t('adminAnnouncement.deleteConfirm')}
        message={`"${deleteTarget?.titleEn}"`}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  )
}
