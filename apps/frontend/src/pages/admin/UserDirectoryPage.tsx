import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search, Edit2, Trash2, Upload, Ban, CheckCircle } from 'lucide-react'
import { roleSchema, type UserResponse, type Role } from '@btec-lms/shared'
import {
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  importUsersCsv,
  type ImportResult,
} from '../../api/admin-users.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Modal } from '../../components/ui/Modal.js'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { Badge } from '../../components/ui/Badge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

const ROLES: Role[] = ['ADMIN', 'USER']
const PAGE_SIZE = 20

function randomPassword(): string {
  return Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-6).toUpperCase()
}

// ─── Create / Edit user modal ──────────────────────────────────────────────

const userFormSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72).optional(),
  role: roleSchema,
  position: z.string().max(100).optional(),
})
type UserFormValues = z.infer<typeof userFormSchema>

interface UserFormModalProps {
  isOpen: boolean
  onClose: () => void
  editUser?: UserResponse
}

function UserFormModal({ isOpen, onClose, editUser }: UserFormModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(
      editUser ? userFormSchema.omit({ password: true }) : userFormSchema.required({ password: true }),
    ),
    defaultValues: editUser
      ? {
          name: editUser.name,
          email: editUser.email,
          role: editUser.role,
          position: editUser.position ?? '',
        }
      : { name: '', email: '', password: '', role: 'USER', position: '' },
  })

  const onSubmit = async (values: UserFormValues) => {
    try {
      if (editUser) {
        await updateAdminUser(editUser.id, {
          name: values.name,
          role: values.role,
          ...(values.position?.trim() ? { position: values.position.trim() } : {}),
        })
        toast.success(t('userDirectory.userUpdated'))
      } else {
        await createAdminUser({
          email: values.email,
          password: values.password!,
          name: values.name,
          role: values.role,
          ...(values.position?.trim() ? { position: values.position.trim() } : {}),
        })
        toast.success(t('userDirectory.userCreated'))
      }
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editUser ? t('userDirectory.editUser') : t('userDirectory.createUser')}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label={`${t('user.name')} *`} error={errors.name?.message} {...register('name')} />
        <Input
          label={`${t('userDirectory.email')} *`}
          type="email"
          disabled={!!editUser}
          error={errors.email?.message}
          {...register('email')}
        />
        {!editUser && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={`${t('userDirectory.password')} *`}
                helperText={t('userDirectory.passwordHelp')}
                error={errors.password?.message}
                {...register('password')}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue('password', randomPassword(), { shouldValidate: true })}
            >
              {t('userDirectory.generatePassword')}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">{t('user.role')}</label>
          <select
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            {...register('role')}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`user.roles.${r}`)}</option>
            ))}
          </select>
        </div>
        <Input label={t('userDirectory.position')} {...register('position')} />

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" isLoading={isSubmitting}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── CSV import modal ───────────────────────────────────────────────────────

interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
}

function ImportModal({ isOpen, onClose }: ImportModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const mutation = useMutation({
    mutationFn: () => importUsersCsv(file!),
    onSuccess: async (res) => {
      setResult(res)
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('userDirectory.importSuccess'))
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const handleClose = () => {
    setFile(null)
    setResult(null)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('userDirectory.importUsers')} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">{t('userDirectory.importHelp')}</p>

        <div>
          <label className="text-xs font-medium text-slate-700">{t('userDirectory.importFile')} *</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null) }}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </div>

        {result && (
          <div className="space-y-3 rounded-xl border border-slate-100 p-4">
            <div className="flex gap-4 text-sm">
              <span>{t('userDirectory.importResultCreated')}: <strong className="text-emerald-600">{result.created}</strong></span>
              <span>{t('userDirectory.importResultSkipped')}: <strong className="text-amber-600">{result.skipped}</strong></span>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('userDirectory.importRowErrors')}
              </p>
              {result.errors.length === 0 ? (
                <p className="text-sm text-emerald-600">{t('userDirectory.importNoErrors')}</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">{t('userDirectory.importRow')}</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">{t('userDirectory.email')}</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-500">{t('userDirectory.importReason')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.errors.map((e, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-slate-600">{e.row}</td>
                          <td className="px-3 py-2 text-slate-600">{e.email || '—'}</td>
                          <td className="px-3 py-2 text-red-600">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" type="button" onClick={handleClose}>{t('common.close')}</Button>
          <Button
            type="button"
            isLoading={mutation.isPending}
            disabled={!file}
            onClick={() => mutation.mutate()}
          >
            {t('userDirectory.importSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── UserDirectoryPage ──────────────────────────────────────────────────────

export default function UserDirectoryPage() {
  const { t } = useTranslation()
  const { user: currentUser } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'' | Role>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'suspended'>('')
  const [page, setPage] = useState(1)
  const [formModal, setFormModal] = useState<{ open: boolean; user?: UserResponse }>({ open: false })
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserResponse | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<{ user: UserResponse; next: boolean } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'users', search, roleFilter, statusFilter, page],
    queryFn: () =>
      listAdminUsers({
        ...(search ? { search } : {}),
        ...(roleFilter ? { role: roleFilter } : {}),
        ...(statusFilter ? { isActive: statusFilter === 'active' } : {}),
        page,
        limit: PAGE_SIZE,
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminUser(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(t('userDirectory.userDeleted'))
      setDeleteTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const suspendMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateAdminUser(id, { isActive }),
    onSuccess: async (_, vars) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      toast.success(vars.isActive ? t('userDirectory.userActivated') : t('userDirectory.userSuspended'))
      setSuspendTarget(null)
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const columns = useMemo<Column<UserResponse>[]>(
    () => [
      {
        key: 'name',
        header: t('user.name'),
        render: (u) => (
          <div>
            <p className="font-medium text-slate-800">{u.name}</p>
            <p className="text-xs text-slate-400">{u.email}</p>
          </div>
        ),
      },
      {
        key: 'role',
        header: t('user.role'),
        width: '12%',
        render: (u) => <Badge variant={u.role === 'ADMIN' ? 'purple' : 'gray'}>{t(`user.roles.${u.role}`)}</Badge>,
      },
      {
        key: 'status',
        header: t('adminCourse.status'),
        width: '10%',
        render: (u) => <StatusBadge type="user" status={u.isActive ? 'active' : 'suspended'} />,
      },
      {
        key: 'lastLoginAt',
        header: t('userDirectory.lastLogin'),
        width: '14%',
        render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : t('userDirectory.never')),
      },
      {
        key: 'actions',
        header: '',
        width: '18%',
        align: 'right',
        render: (u) => {
          const isSelf = u.id === currentUser?.id
          return (
            <div className="flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setFormModal({ open: true, user: u })} title={t('common.edit')}>
                <Edit2 size={14} />
              </Button>
              {u.isActive ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSuspendTarget({ user: u, next: false })}
                  title={t('userDirectory.suspend')}
                  className="text-amber-500 hover:text-amber-700"
                >
                  <Ban size={14} />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSuspendTarget({ user: u, next: true })}
                  title={t('userDirectory.activate')}
                  className="text-emerald-500 hover:text-emerald-700"
                >
                  <CheckCircle size={14} />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleteTarget(u)}
                disabled={isSelf}
                title={isSelf ? t('userDirectory.cannotDeleteSelf') : t('common.delete')}
                className="text-red-400 hover:text-red-600 disabled:text-slate-200"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          )
        },
      },
    ],
    [t, currentUser?.id],
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('userDirectory.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" leftIcon={<Upload size={15} />} onClick={() => setImportOpen(true)}>
            {t('user.importCsv')}
          </Button>
          <Button leftIcon={<Plus size={16} />} onClick={() => setFormModal({ open: true })}>
            {t('userDirectory.newUser')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder={t('userDirectory.search')}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value as typeof roleFilter); setPage(1) }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:w-auto"
        >
          <option value="">{t('userDirectory.allRoles')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{t(`user.roles.${r}`)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1) }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:w-auto"
        >
          <option value="">{t('userDirectory.allStatus')}</option>
          <option value="active">{t('status.user.active')}</option>
          <option value="suspended">{t('status.user.suspended')}</option>
        </select>
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetch()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      <DataTable<UserResponse>
        columns={columns}
        data={data?.data ?? []}
        keyField="id"
        isLoading={isLoading}
        emptyMessage={t('userDirectory.noUsers')}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: setPage,
        }}
      />

      <UserFormModal
        key={formModal.user?.id ?? 'new'}
        isOpen={formModal.open}
        onClose={() => setFormModal({ open: false })}
        {...(formModal.user !== undefined ? { editUser: formModal.user } : {})}
      />

      <ImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        isOpen={suspendTarget != null}
        onClose={() => setSuspendTarget(null)}
        onConfirm={() => {
          if (suspendTarget) suspendMutation.mutate({ id: suspendTarget.user.id, isActive: suspendTarget.next })
        }}
        title={suspendTarget?.next ? t('userDirectory.activateConfirm') : t('userDirectory.suspendConfirm')}
        message={`"${suspendTarget?.user.name}"`}
        confirmLabel={suspendTarget?.next ? t('userDirectory.activate') : t('userDirectory.suspend')}
        variant={suspendTarget?.next ? 'brand' : 'danger'}
        isLoading={suspendMutation.isPending}
      />

      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id) }}
        title={t('userDirectory.deleteConfirm')}
        message={`"${deleteTarget?.name}"`}
        confirmLabel={t('common.delete')}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  )
}
