import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Search, X, Eye } from 'lucide-react'
import type { ExternalCertResponse, UserResponse } from '@btec-lms/shared'
import { Card } from '../../components/ui/Card.js'
import { DataTable, type Column } from '../../components/ui/DataTable.js'
import { Button } from '../../components/ui/Button.js'
import { FileInput } from '../../components/ui/FileInput.js'
import { Modal } from '../../components/ui/Modal.js'
import { listExternalCerts, createExternalCert } from '../../api/external-certs.js'
import { listAdminUsers } from '../../api/admin-users.js'
import { useAuth } from '../../hooks/useAuth.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { formatDate } from '../../lib/format.js'

// ─── Add external certificate modal ────────────────────────────────────────

interface AddExternalCertModalProps {
  isOpen: boolean
  onClose: () => void
}

function AddExternalCertModal({ isOpen, onClose }: AddExternalCertModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [issuer, setIssuer] = useState('')
  const [issuedAt, setIssuedAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setTitle(''); setIssuer(''); setIssuedAt(''); setExpiresAt(''); setFile(null); setProgress(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleClose = () => { reset(); onClose() }

  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append('title', title.trim())
      fd.append('issuer', issuer.trim())
      fd.append('issuedAt', new Date(issuedAt).toISOString())
      if (expiresAt) fd.append('expiresAt', new Date(expiresAt).toISOString())
      if (file) fd.append('file', file)
      return createExternalCert(fd, setProgress)
    },
    onSuccess: async () => {
      toast.success(t('externalCert.added'))
      await qc.invalidateQueries({ queryKey: ['external-certs'] })
      handleClose()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
    onSettled: () => setProgress(null),
  })

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('externalCert.add')} size="md">
      <form
        onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
        className="space-y-4"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700">{t('externalCert.certTitle')} *</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700">{t('externalCert.issuer')} *</label>
          <input
            required
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">{t('externalCert.issuedAt')} *</label>
            <input
              type="date"
              required
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700">{t('externalCert.expiresAt')}</label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-700">{t('externalCert.fileUpload')}</label>
          <FileInput
            ref={fileRef}
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            file={file}
            onChange={setFile}
          />
        </div>

        {progress !== null && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{t('externalCert.uploading')}</span>
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
          <Button variant="ghost" type="button" onClick={handleClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={mutation.isPending} disabled={!title.trim() || !issuer.trim() || !issuedAt}>
            {t('externalCert.add')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Admin: search-and-pick another user to view their external certs ──────

interface UserSearchPickerProps {
  selected: UserResponse | null
  onSelect: (user: UserResponse | null) => void
}

function UserSearchPicker({ selected, onSelect }: UserSearchPickerProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'users', 'search-picker', debouncedQuery],
    queryFn: () => listAdminUsers({ search: debouncedQuery, limit: 8 }),
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
  })

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
        <span className="text-slate-600">{t('externalCert.viewing')}:</span>
        <span className="font-medium text-slate-800">{selected.name}</span>
        <span className="text-xs text-slate-400">{selected.email}</span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="ml-1 rounded-full p-0.5 text-slate-400 hover:bg-brand-100 hover:text-slate-600"
          title={t('externalCert.backToMine')}
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={t('externalCert.searchUser')}
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </div>
      {open && debouncedQuery.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-lg">
          {isFetching ? (
            <p className="px-3 py-2 text-sm text-slate-400">{t('common.loading')}</p>
          ) : data && data.data.length > 0 ? (
            data.data.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { onSelect(u); setQuery(''); setOpen(false) }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-800">{u.name}</span>{' '}
                <span className="text-xs text-slate-400">{u.email}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-sm text-slate-400">{t('externalCert.noUsersFound')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── MyCertificatesPage (a.k.a. "External Certificates") ───────────────────

export default function MyCertificatesPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [addOpen, setAddOpen] = useState(false)
  const [viewingUser, setViewingUser] = useState<UserResponse | null>(null)

  const isAdmin = user?.role === 'ADMIN'
  const targetUserId = viewingUser?.id

  const {
    data: extCerts,
    isLoading: eLoad,
    isError: eErr,
    refetch: eRefetch,
  } = useQuery({
    queryKey: ['external-certs', targetUserId ?? 'self'],
    queryFn: () => listExternalCerts(targetUserId),
    staleTime: 60_000,
  })

  const extColumns: Column<ExternalCertResponse>[] = [
    {
      key: 'title',
      header: t('material.title'),
      skeleton: 'text',
      render: (r) => <span className="font-medium text-slate-800">{r.title}</span>,
    },
    { key: 'issuer', header: t('externalCert.issuer'), skeleton: 'text' },
    {
      key: 'issuedAt',
      header: t('certificate.issued'),
      skeleton: 'text',
      render: (r) => formatDate(r.issuedAt, i18n.language),
    },
    {
      key: 'expiresAt',
      header: t('certificate.expires'),
      skeleton: 'text',
      render: (r) => (r.expiresAt != null ? formatDate(r.expiresAt, i18n.language) : '—'),
    },
    {
      key: 'fileKey',
      header: '',
      width: '90px',
      align: 'right',
      skeleton: 'icons',
      render: (r) =>
        r.signedUrl != null ? (
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Eye size={12} />}
            onClick={() => window.open(r.signedUrl!, '_blank', 'noopener,noreferrer')}
          >
            {t('externalCert.view')}
          </Button>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
  ]

  if (eErr) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-500">{t('common.error')}</p>
        <button
          className="mt-2 text-sm text-brand-500 hover:underline"
          onClick={() => void eRefetch()}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-slate-800">{t('nav.certificates')}</h1>
        {isAdmin && <UserSearchPicker selected={viewingUser} onSelect={setViewingUser} />}
      </div>

      <Card
        header={
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {t('externalCert.title')}
            </h2>
            {!viewingUser && (
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                {t('externalCert.add')}
              </Button>
            )}
          </div>
        }
      >
        <DataTable<ExternalCertResponse>
          columns={extColumns}
          data={extCerts ?? []}
          keyField="id"
          isLoading={eLoad}
          emptyMessage={t('externalCert.noData')}
        />
      </Card>

      <AddExternalCertModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}
