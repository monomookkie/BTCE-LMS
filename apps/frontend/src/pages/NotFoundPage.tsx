import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPinOff } from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher.js'

const HEADER_GRADIENT = { background: 'linear-gradient(135deg,#0D1B2A,#1A3A5C)' }
const PAGE_GRADIENT = { background: 'linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)' }

// ไม่เรียก useAuth() ที่นี่ — /auth/me จะ 401 สำหรับ visitor ที่ยังไม่ login และ apiFetch's
// global 401 handler จะ hard-redirect ไป /login ทันที (window.location.href) ก่อนหน้านี้จะ render ทัน
// "กลับหน้าหลัก" ใช้ Link ไป "/" ซึ่ง RootRedirect จัดการ auth-branching ให้แล้ว ไม่ต้องเช็คซ้ำที่นี่
export default function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={PAGE_GRADIENT}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="px-8 py-6 text-white" style={HEADER_GRADIENT}>
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
          <div className="flex items-center gap-2">
            <MapPinOff size={20} />
            <h1 className="text-xl font-bold">{t('notFound.title')}</h1>
          </div>
          <p className="mt-1 text-sm text-white/70">{t('notFound.message')}</p>
        </div>

        <div className="flex flex-col items-center gap-4 px-8 py-8">
          <p className="text-5xl font-bold text-slate-200">404</p>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t('notFound.backButton')}
          </Link>
        </div>
      </div>
    </div>
  )
}
