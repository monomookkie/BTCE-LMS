import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, Eye, Download, Ban, FileText } from 'lucide-react'
import type { CertificateAdminResponse, CertStatus } from '@btec-lms/shared'
import {
  listAdminCertificates,
  getAdminCertificate,
  downloadCertPdf,
  revokeCertificate,
  listUserExternalCerts,
} from '../../api/admin-certificates.js'
import { listAdminCourses } from '../../api/admin-courses.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Select } from '../../components/ui/Select.js'
import { Modal } from '../../components/ui/Modal.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

const STATUSES: CertStatus[] = ['valid', 'expiring-soon', 'expired', 'revoked']
const PAGE_SIZE = 20

// ─── Revoke modal — reason textarea + confirm (ADMIN only) ────────────────────

interface RevokeModalProps {
  cert: CertificateAdminResponse | null
  onClose: () => void
}

function RevokeModal({ cert, onClose }: RevokeModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: () => revokeCertificate(cert!.id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'certificates'] })
      toast.success(t('adminCertificate.revoked'))
      setReason('')
      onClose()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  return (
    <Modal isOpen={cert != null} onClose={onClose} title={t('adminCertificate.revokeConfirm')} size="sm">
      <p className="mb-3 text-sm text-slate-600">
        {cert?.certNumber} — {cert?.userName}
      </p>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {t('adminCertificate.revokeReason')}
      </label>
      <textarea
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder={t('adminCertificate.revokeReasonPlaceholder')}
        className="mb-6 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" size="sm" onClick={() => mutation.mutate()} isLoading={mutation.isPending}>
          {t('adminCertificate.revoke')}
        </Button>
      </div>
    </Modal>
  )
}

// ─── Detail modal — info + external certs + download + revoke entry point ────

interface DetailModalProps {
  certId: string | null
  onClose: () => void
  isAdmin: boolean
  onRequestRevoke: (cert: CertificateAdminResponse) => void
}

function DetailModal({ certId, onClose, isAdmin, onRequestRevoke }: DetailModalProps) {
  const { t } = useTranslation()
  const toast = useToast()

  const { data: cert, isLoading } = useQuery({
    queryKey: ['admin', 'certificates', 'detail', certId],
    queryFn: () => getAdminCertificate(certId!),
    enabled: certId != null,
  })

  const { data: externalCerts } = useQuery({
    queryKey: ['admin', 'external-certs', cert?.userId],
    queryFn: () => listUserExternalCerts(cert!.userId),
    enabled: cert != null,
  })

  const downloadMutation = useMutation({
    mutationFn: () => downloadCertPdf(cert!.id, cert!.certNumber),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  return (
    <Modal isOpen={certId != null} onClose={onClose} title={t('adminCertificate.detail')} size="md">
      {isLoading || !cert ? (
        <p className="py-6 text-center text-sm text-slate-400">{t('common.loading')}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">{t('certificate.certNumber')}</p>
              <p className="font-medium text-slate-800">{cert.certNumber}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('adminCourse.status')}</p>
              <StatusBadge type="cert" status={cert.status} />
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('user.name')}</p>
              <p className="text-slate-800">{cert.userName}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('auth.email')}</p>
              <p className="text-slate-800">{cert.userEmail}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('course.label')}</p>
              <p className="text-slate-800">{cert.courseTitle}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('adminCertificate.score')}</p>
              <p className="text-slate-800">{cert.score}%</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('certificate.issued')}</p>
              <p className="text-slate-800">{new Date(cert.issuedAt).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">{t('certificate.expires')}</p>
              <p className="text-slate-800">{cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : '—'}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Download size={14} />}
              isLoading={downloadMutation.isPending}
              onClick={() => downloadMutation.mutate()}
            >
              {t('certificate.download')}
            </Button>
            {isAdmin && cert.status !== 'revoked' && (
              <Button
                size="sm"
                variant="danger"
                leftIcon={<Ban size={14} />}
                onClick={() => onRequestRevoke(cert)}
              >
                {t('adminCertificate.revoke')}
              </Button>
            )}
          </div>

          {/* External certs uploaded by this user */}
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <FileText size={14} /> {t('externalCert.title')}
            </p>
            {!externalCerts || externalCerts.length === 0 ? (
              <p className="text-sm text-slate-400">{t('externalCert.noData')}</p>
            ) : (
              <ul className="space-y-2">
                {externalCerts.map((ec) => (
                  <li key={ec.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{ec.title}</p>
                      <p className="text-xs text-slate-400">
                        {t('externalCert.issuer')}: {ec.issuer}
                      </p>
                    </div>
                    {ec.signedUrl && (
                      <a
                        href={ec.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-brand-600 underline hover:no-underline"
                      >
                        {t('certificate.download')}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── CertificateEnginePage ─────────────────────────────────────────────────────

export default function CertificateEnginePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | CertStatus>('')
  const [courseFilter, setCourseFilter] = useState('')
  const [page, setPage] = useState(1)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<CertificateAdminResponse | null>(null)

  const { data: courses } = useQuery({
    queryKey: ['admin', 'courses', 'all-for-filter'],
    queryFn: () => listAdminCourses({ limit: 100 }),
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'certificates', statusFilter, courseFilter, search, page],
    queryFn: () =>
      listAdminCertificates({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(courseFilter ? { courseId: courseFilter } : {}),
        ...(search ? { search } : {}),
        page,
        limit: PAGE_SIZE,
      }),
  })

  const columns = useMemo<Column<CertificateAdminResponse>[]>(
    () => [
      { key: 'certNumber', header: t('certificate.certNumber'), width: '16%', skeleton: 'text' },
      {
        key: 'userName',
        header: t('user.name'),
        width: '20%',
        skeleton: 'text-sub',
        render: (c) => (
          <div>
            <p className="font-medium text-slate-800">{c.userName}</p>
            <p className="text-xs text-slate-400">{c.userEmail}</p>
          </div>
        ),
      },
      { key: 'courseTitle', header: t('course.label'), width: '22%', skeleton: 'text' },
      { key: 'status', header: t('adminCourse.status'), width: '13%', skeleton: 'pill',
        render: (c) => <StatusBadge type="cert" status={c.status} /> },
      { key: 'issuedAt', header: t('certificate.issued'), width: '12%', skeleton: 'text',
        render: (c) => new Date(c.issuedAt).toLocaleDateString() },
      { key: 'expiresAt', header: t('certificate.expires'), width: '12%', skeleton: 'text',
        render: (c) => c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—' },
      {
        key: 'actions',
        header: '',
        width: '8%',
        align: 'right',
        skeleton: 'icons',
        render: (c) => (
          <Button size="sm" variant="ghost" onClick={() => setDetailId(c.id)} title={t('adminCertificate.detail')}>
            <Eye size={14} />
          </Button>
        ),
      },
    ],
    [t],
  )

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-800">{t('adminCertificate.title')}</h1>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder={t('adminCertificate.search')}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <Select
          value={courseFilter}
          onChange={(v) => { setCourseFilter(v); setPage(1) }}
          options={[
            { value: '', label: t('reports.allCourses') },
            ...(courses?.data.map((c) => ({ value: c.id, label: c.titleEn })) ?? []),
          ]}
        />
        <Select
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(1) }}
          options={[
            { value: '', label: t('adminCourse.allStatus') },
            ...STATUSES.map((s) => ({
              value: s,
              label: t(`status.cert.${s === 'expiring-soon' ? 'expiringSoon' : s}`),
            })),
          ]}
        />
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetch()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      <DataTable<CertificateAdminResponse>
        columns={columns}
        data={data?.data ?? []}
        keyField="id"
        isLoading={isLoading}
        emptyMessage={t('adminCertificate.noCertificates')}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: setPage,
        }}
      />

      <DetailModal
        certId={detailId}
        onClose={() => setDetailId(null)}
        isAdmin={isAdmin}
        onRequestRevoke={(cert) => { setDetailId(null); setRevokeTarget(cert) }}
      />

      <RevokeModal cert={revokeTarget} onClose={() => setRevokeTarget(null)} />
    </div>
  )
}
