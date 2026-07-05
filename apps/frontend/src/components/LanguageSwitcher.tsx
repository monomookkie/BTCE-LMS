import { useLanguage } from '../hooks/useLanguage.js'
import type { SupportedLocale } from '../i18n/index.js'

interface Props {
  isAuthenticated?: boolean
  className?: string
}

const OPTIONS: { value: SupportedLocale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'th', label: 'TH' },
]

export function LanguageSwitcher({ isAuthenticated = false, className }: Props) {
  const { language, changeLanguage } = useLanguage({ isAuthenticated })

  return (
    <div
      className={['inline-flex rounded border border-gray-200 bg-white shadow-sm', className].filter(Boolean).join(' ')}
      role="group"
      aria-label="Language / ภาษา"
    >
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => void changeLanguage(value)}
          className={[
            'px-3 py-1 text-sm font-medium transition-colors first:rounded-l last:rounded-r focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            language === value
              ? 'bg-brand-500 text-white'
              : 'text-gray-600 hover:bg-gray-50',
          ].join(' ')}
          aria-pressed={language === value}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
