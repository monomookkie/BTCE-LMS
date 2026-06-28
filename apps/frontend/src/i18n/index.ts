import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import th from './locales/th.json'

export type SupportedLocale = 'en' | 'th'

const STORAGE_KEY = 'btec-lms-language'

function detectInitialLanguage(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'th') return stored
  return navigator.language.toLowerCase().startsWith('th') ? 'th' : 'en'
}

export function persistLanguage(lang: SupportedLocale): void {
  localStorage.setItem(STORAGE_KEY, lang)
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    th: { translation: th },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18next
