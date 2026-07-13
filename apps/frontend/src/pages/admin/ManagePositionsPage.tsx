import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Plus, Edit2, Trash2, Merge } from 'lucide-react'
import { createPositionInputSchema, type PositionAdminResponse } from '@btec-lms/shared'
import {
  listAdminPositions,
  createAdminPosition,
  updateAdminPosition,
  deleteAdminPosition,
  mergeAdminPosition,
} from '../../api/admin-positions.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { Badge } from '../../components/ui/Badge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

// ─── Create / Edit position modal ──────────────────────────────────────────

const positionFormSchema = createPositionInputSchema
type PositionFormValues = z.infer<typeof positionFormSchema>

interface PositionFormModalProps {
  isOpen: boolean
  onClose: () => void
  editPosition?: PositionAdminResponse
}

function PositionFormModal({ isOpen, onClose, editPosition }: PositionFormModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PositionFormValues>({
    resolver: zodResolver(positionFormSchema),
    defaultValues: editPosition
      ? { nameEn: editPosition.nameEn, nameTh: editPosition.nameTh ?? '' }
      : { nameEn: '', nameTh: '' },
  })

  const onSubmit = async (values: PositionFormValues) => {
    try {
      const body = { nameEn: values.nameEn, ...(values.nameTh?.trim() ? { nameTh: values.nameTh.trim() } : {}) }
      if (editPosition) {
        await updateAdminPosition(editPosition.id, body)
        toast.success(t('positions.positionUpdated'))
      } else {
        await createAdminPosition(body)
        toast.success(t('positions.positionCreated'))
      }
      await qc.invalidateQueries({ queryKey: ['admin', 'positions'] })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editPosition ? t('positions.editPosition') : t('positions.newPosition')}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={`${t('positions.nameEn')} *`} error={errors.nameEn?.message} {...register('nameEn')} />
        <Input label={t('positions.nameTh')} error={errors.nameTh?.message} {...register('nameTh')} />

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Merge modal ────────────────────────────────────────────────────────────

interface MergeModalProps {
  isOpen: boolean
  onClose: () => void
  source: PositionAdminResponse | null
  positions: PositionAdminResponse[]
}

function MergeModal({ isOpen, onClose, source, positions }: MergeModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [targetId, setTargetId] = useState('')
  const [confirming, setConfirming] = useState(false)

  const target = positions.find((p) => p.id === targetId)

  const mergeMutation = useMutation({
    mutationFn: () => mergeAdminPosition(source!.id, { targetPositionId: targetId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'positions'] })
      toast.success(t('positions.mergeSuccess'))
      handleClose()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const handleClose = () => {
    setTargetId('')
    setConfirming(false)
    onClose()
  }

  if (!source) return null

  const targetOptions = positions
    .filter((p) => p.id !== source.id)
    .map((p) => ({ value: p.id, label: p.name }))

  return (
    <>
      <Modal isOpen={isOpen && !confirming} onClose={handleClose} title={t('positions.mergeTitle')} size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('positions.mergeInto')}: <strong>{source.name}</strong>
          </p>
          <Select
            label={t('positions.mergeSelectTarget')}
            value={targetId}
            onChange={setTargetId}
            placeholder={t('positions.mergeSelectTarget')}
            options={targetOptions}
          />
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button variant="ghost" type="button" onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              type="button"
              disabled={!targetId}
              onClick={() => setConfirming(true)}
            >
              {t('positions.merge')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => mergeMutation.mutate()}
        title={t('positions.mergeConfirmTitle')}
        message={
          target
            ? t('positions.mergeConfirmMessage', {
                userCount: source.userCount,
                courseCount: source.courseCount,
                source: source.name,
                target: target.name,
              })
            : ''
        }
        confirmLabel={t('positions.merge')}
        variant="danger"
        isLoading={mergeMutation.isPending}
      />
    </>
  )
}

// ─── ManagePositionsPage ────────────────────────────────────────────────────

export default function ManagePositionsPage() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [formModal, setFormModal] = useState<{ open: boolean; position?: PositionAdminResponse }>({ open: false })
  const [mergeTarget, setMergeTarget] = useState<PositionAdminResponse | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PositionAdminResponse | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'positions'],
    queryFn: listAdminPositions,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminPosition(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'positions'] })
      toast.success(t('positions.positionDeleted'))
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const positions = data ?? []

  const columns = useMemo<Column<PositionAdminResponse>[]>(
    () => [
      {
        key: 'name',
        header: t('positions.nameEn'),
        skeleton: 'text-sub',
        render: (p) => (
          <div>
            <p className="font-medium text-slate-800">{p.nameEn}</p>
            {p.nameTh && <p className="text-xs text-slate-400">{p.nameTh}</p>}
          </div>
        ),
      },
      {
        key: 'userCount',
        header: t('positions.userCount'),
        width: '12%',
        skeleton: 'pill',
        render: (p) => <Badge variant="gray">{p.userCount}</Badge>,
      },
      {
        key: 'courseCount',
        header: t('positions.courseCount'),
        width: '12%',
        skeleton: 'pill',
        render: (p) => <Badge variant="gray">{p.courseCount}</Badge>,
      },
      {
        key: 'actions',
        header: '',
        width: '18%',
        align: 'right',
        skeleton: 'icons',
        render: (p) => (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setFormModal({ open: true, position: p })} title={t('common.edit')}>
              <Edit2 size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMergeTarget(p)}
              disabled={positions.length < 2}
              title={t('positions.merge')}
              className="text-brand-500 hover:text-brand-700"
            >
              <Merge size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleteTarget(p)}
              disabled={p.userCount > 0 || p.courseCount > 0}
              title={p.userCount > 0 || p.courseCount > 0 ? t('positions.deleteConfirm') : t('common.delete')}
              className="text-red-400 hover:text-red-600 disabled:text-slate-200"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ),
      },
    ],
    [t, positions.length],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('positions.title')}</h1>
        <Button leftIcon={<Plus size={16} />} onClick={() => setFormModal({ open: true })}>
          {t('positions.newPosition')}
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

      <DataTable<PositionAdminResponse>
        columns={columns}
        data={positions}
        keyField="id"
        isLoading={isLoading}
        emptyMessage={t('positions.noPositions')}
      />

      <PositionFormModal
        key={formModal.position?.id ?? 'new'}
        isOpen={formModal.open}
        onClose={() => setFormModal({ open: false })}
        {...(formModal.position !== undefined ? { editPosition: formModal.position } : {})}
      />

      <MergeModal
        isOpen={mergeTarget != null}
        onClose={() => setMergeTarget(null)}
        source={mergeTarget}
        positions={positions}
      />

      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
        title={t('positions.deleteConfirm')}
        message={`"${deleteTarget?.name}"`}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  )
}
