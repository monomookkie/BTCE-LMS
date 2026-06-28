import { useTranslation } from 'react-i18next'
import { Routes, Route } from 'react-router-dom'
import { LanguageSwitcher } from './components/LanguageSwitcher.js'

export default function App() {
  const { t } = useTranslation()

  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="flex min-h-screen items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <LanguageSwitcher />
              </div>
              <h1 className="text-2xl font-bold text-brand-red">{t('demo.title')}</h1>
              <p className="mt-2 text-gray-600">{t('demo.subtitle')}</p>
              <p className="mt-4 text-sm text-gray-400">{t('demo.phase')}</p>
              <p className="mt-2 text-sm font-medium text-green-600">{t('demo.i18nReady')}</p>
              <p className="mt-1 text-xs text-gray-400">{t('demo.switchHint')}</p>
            </div>
          </div>
        }
      />
    </Routes>
  )
}
