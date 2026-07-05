import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download, Plus } from 'lucide-react'
import type { CertificatePublicResponse, ExternalCertResponse } from '@btec-lms/shared'
import { Card } from '../../components/ui/Card.js'
import { DataTable, type Column } from '../../components/ui/DataTable.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { Button } from '../../components/ui/Button.js'
import { Modal } from '../../components/ui/Modal.js'
import {
  listMyCertificates,
  listExternalCerts,
  createExternalCert,
  downloadCertPdf,
} from '../../api/certificates.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { formatDate } from '../../lib/format.js'

const CERTS_ME_KEY = ['certificates', 'me'] as const
const EXTERNAL_CERTS_KEY = ['external-certs'] as const

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
      await qc.invalidateQueries({ queryKey: EXTERNAL_CERTS_KEY })
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

        <div className="grid grid-cols-2 gap-3">
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
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-brand-700 hover:file:bg-brand-100"
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

export default function MyCertificatesPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const {
    data: certPage,
    isLoading: cLoad,
    isError: cErr,
    refetch: cRefetch,
  } = useQuery({
    queryKey: CERTS_ME_KEY,
    queryFn: () => listMyCertificates(),
    staleTime: 60_000,
  })

  const {
    data: extCerts,
    isLoading: eLoad,
    isError: eErr,
    refetch: eRefetch,
  } = useQuery({
    queryKey: EXTERNAL_CERTS_KEY,
    queryFn: () => listExternalCerts(),
    staleTime: 60_000,
  })

  async function handleDownload(id: string, certNumber: string) {
    if (downloading !== null) return
    setDownloading(id)
    try {
      await downloadCertPdf(id, certNumber)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      toast.error(message)
    } finally {
      setDownloading(null)
    }
  }

  const certColumns: Column<CertificatePublicResponse>[] = [
    {
      key: 'courseTitle',
      header: t('course.label'),
      skeleton: 'text',
      render: (r) => (
        <span className="font-medium text-slate-800">{r.courseTitle}</span>
      ),
    },
    {
      key: 'score',
      header: t('quiz.score'),
      align: 'center',
      width: '80px',
      skeleton: 'text',
      render: (r) => `${r.score}%`,
    },
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
      key: 'status',
      header: 'Status',
      width: '130px',
      skeleton: 'pill',
      render: (r) => <StatusBadge type="cert" status={r.status} />,
    },
    {
      key: 'certNumber',
      header: '',
      width: '140px',
      align: 'right',
      skeleton: 'icons',
      render: (r) => (
        <Button
          size="sm"
          variant="outline"
          isLoading={downloading === r.id}
          disabled={downloading !== null}
          leftIcon={<Download size={12} />}
          onClick={() => void handleDownload(r.id, r.certNumber)}
        >
          {t('certificate.download')}
        </Button>
      ),
    },
  ]

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
  ]

  if (cErr || eErr) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-500">{t('common.error')}</p>
        <button
          className="mt-2 text-sm text-brand-500 hover:underline"
          onClick={() => { void cRefetch(); void eRefetch() }}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold text-slate-800">{t('nav.certificates')}</h1>

      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">
            {t('certificate.certificates')}
          </h2>
        }
      >
        <DataTable<CertificatePublicResponse>
          columns={certColumns}
          data={certPage?.data ?? []}
          keyField="id"
          isLoading={cLoad}
          emptyMessage={t('dashboard.emptyCerts')}
        />
      </Card>

      <Card
        header={
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {t('externalCert.title')}
            </h2>
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
              {t('externalCert.add')}
            </Button>
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
