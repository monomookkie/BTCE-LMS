import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { SupportedLocale } from '../i18n/index.js'
import { persistLanguage } from '../i18n/index.js'
import { apiFetch } from '../lib/api.js'

interface UseLanguageOptions {
  isAuthenticated?: boolean
}

interface UseLanguageReturn {
  language: SupportedLocale
  changeLanguage: (lang: SupportedLocale) => Promise<void>
}

export function useLanguage({ isAuthenticated = false }: UseLanguageOptions = {}): UseLanguageReturn {
  const { i18n } = useTranslation()

  const changeLanguage = useCallback(
    async (lang: SupportedLocale) => {
      // 1. Switch UI immediately — ไม่รอ backend
      await i18n.changeLanguage(lang)
      // 2. Persist ลง localStorage (ใช้ข้าม reload + guest)
      persistLanguage(lang)
      // 3. Sync ไป backend เมื่อ login อยู่
      if (isAuthenticated) {
        try {
          await apiFetch('/users/me', { method: 'PATCH', json: { language: lang } })
        } catch {
          // non-blocking: UI เปลี่ยนแล้ว แม้ backend sync ล้มเหลว
        }
      }
    },
    [i18n, isAuthenticated],
  )

  return {
    language: i18n.language as SupportedLocale,
    changeLanguage,
  }
}
