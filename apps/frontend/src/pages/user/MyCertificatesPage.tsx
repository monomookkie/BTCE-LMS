import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import type { CertificatePublicResponse, ExternalCertResponse } from '@btec-lms/shared'
import { Card } from '../../components/ui/Card.js'
import { DataTable, type Column } from '../../components/ui/DataTable.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { Button } from '../../components/ui/Button.js'
import {
  listMyCertificates,
  listExternalCerts,
  downloadCertPdf,
} from '../../api/certificates.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { formatDate } from '../../lib/format.js'

const CERTS_ME_KEY = ['certificates', 'me'] as const
const EXTERNAL_CERTS_KEY = ['external-certs'] as const

export default function MyCertificatesPage() {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [downloading, setDownloading] = useState<string | null>(null)

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
          <h2 className="text-sm font-semibold text-slate-700">
            {t('externalCert.title')}
          </h2>
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
    </div>
  )
}
