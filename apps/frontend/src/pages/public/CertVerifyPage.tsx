import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, ShieldAlert, ShieldX, Search } from 'lucide-react'
import { getPublicCertificate } from '../../api/public-certificates.js'
import { ApiError } from '../../lib/api.js'
import { LanguageSwitcher } from '../../components/LanguageSwitcher.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { Skeleton } from '../../components/ui/Skeleton.js'

const HEADER_GRADIENT = { background: 'linear-gradient(135deg,#0D1B2A,#1A3A5C)' }
const PAGE_GRADIENT = { background: 'linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)' }

// mirror ของผลลัพธ์ verify จริง — status row (label+badge pill), แล้ว 5 แถว dt/dd label-value
function VerifyResultSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <dl className="space-y-3 border-t border-slate-100 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function CertVerifyPage() {
  const { t } = useTranslation()
  const { hash } = useParams<{ hash: string }>()

  const { data, error, isLoading } = useQuery({
    queryKey: ['public', 'verify', hash],
    queryFn: () => getPublicCertificate(hash!),
    enabled: !!hash,
    retry: false,
  })

  const notFound = error instanceof ApiError && error.status === 404
  const otherError = error != null && !notFound

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={PAGE_GRADIENT}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Card header — navy gradient, matches LoginPage */}
        <div className="px-8 py-6 text-white" style={HEADER_GRADIENT}>
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
          <div className="flex items-center gap-2">
            <Search size={20} />
            <h1 className="text-xl font-bold">{t('verify.title')}</h1>
          </div>
          <p className="mt-1 text-sm text-white/70">{t('verify.subtitle')}</p>
        </div>

        <div className="px-8 py-6">
          {isLoading && <VerifyResultSkeleton />}

          {notFound && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <ShieldX size={40} className="text-red-500" />
              <p className="text-base font-semibold text-slate-800">{t('verify.notFoundTitle')}</p>
              <p className="text-sm text-slate-500">{t('verify.notFoundBody')}</p>
            </div>
          )}

          {otherError && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <ShieldAlert size={40} className="text-amber-500" />
              <p className="text-base font-semibold text-slate-800">{t('common.error')}</p>
            </div>
          )}

          {data && (
            <div className="space-y-5">
              {data.status === 'revoked' && (
                <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <ShieldX size={20} className="mt-0.5 shrink-0 text-red-600" />
                  <p className="text-sm font-medium text-red-700">{t('verify.revokedBanner')}</p>
                </div>
              )}

              {data.status === 'valid' && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <ShieldCheck size={20} className="text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700">{t('verify.validBanner')}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">{t('adminCourse.status')}</span>
                <StatusBadge type="cert" status={data.status} />
              </div>

              <dl className="space-y-3 border-t border-slate-100 pt-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{t('certificate.certNumber')}</dt>
                  <dd className="font-medium text-slate-800">{data.certNumber}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{t('verify.holderName')}</dt>
                  <dd className="font-medium text-slate-800">{data.holderName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{t('course.label')}</dt>
                  <dd className="text-right font-medium text-slate-800">{data.courseName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{t('certificate.issued')}</dt>
                  <dd className="text-slate-800">{new Date(data.issuedAt).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{t('certificate.expires')}</dt>
                  <dd className="text-slate-800">
                    {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
