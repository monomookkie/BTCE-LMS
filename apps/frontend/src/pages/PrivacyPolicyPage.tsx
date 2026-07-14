import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher.js'
import { LOGO_URL } from '../lib/branding.js'
import { PDPA_POLICY_VERSION } from '../lib/consent.js'

const SECTION_KEYS = ['dataCollected', 'purpose', 'retention', 'rights', 'contact'] as const

// public route — ไม่เรียก useAuth() (เหตุผลเดียวกับ NotFoundPage: 401 handler จะ hard-redirect
// ก่อน render ทัน ถ้า visitor ยังไม่ login) เข้าถึงได้ทั้งตอน login แล้วและยังไม่ login (เช่นจากหน้า Register)
export default function PrivacyPolicyPage() {
  const { t } = useTranslation()

  return (
    <div
      className="min-h-screen p-4 sm:p-8"
      style={{ background: 'linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)' }}
    >
      <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div
          className="flex items-start justify-between gap-3 px-6 py-5 text-white sm:px-8"
          style={{ background: 'linear-gradient(135deg,#0D1B2A,#1A3A5C)' }}
        >
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt={t('app.name')} className="h-10 w-10 shrink-0 rounded-lg object-contain" />
            <div>
              <h1 className="text-lg font-bold">{t('privacyPolicy.title')}</h1>
              <p className="mt-0.5 text-xs text-white/60">
                {t('privacyPolicy.version', { version: PDPA_POLICY_VERSION })}
              </p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="space-y-6 px-6 py-6 sm:px-8">
          <p className="text-sm leading-relaxed text-slate-600">{t('privacyPolicy.intro')}</p>

          {SECTION_KEYS.map((key) => (
            <section key={key}>
              <h2 className="mb-1.5 text-sm font-semibold text-slate-800">
                {t(`privacyPolicy.${key}Title` as never)}
              </h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {t(`privacyPolicy.${key}Body` as never)}
              </p>
            </section>
          ))}

          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
          >
            <ArrowLeft size={15} />
            {t('common.back')}
          </Link>
        </div>
      </div>
    </div>
  )
}
