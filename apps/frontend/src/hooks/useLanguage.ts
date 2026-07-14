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
      // 1. Persist ลง localStorage (ใช้ข้าม reload + guest)
      persistLanguage(lang)
      // 2. Sync ไป backend ก่อนสลับ UI — resolveLocale() ฝั่ง backend เช็ค DB (req.user.language)
      // เป็นอันดับแรกเสมอ (ข้าม Accept-Language header) ถ้าสลับ UI ก่อน PATCH เสร็จ query ที่ refetch
      // ตาม i18n.language ที่เปลี่ยน (เช่น position list) จะยิงไปชน backend ที่ DB ยังเป็นภาษาเดิม
      // ได้ผลลัพธ์ภาษาเดิมกลับมา ต้อง reload หน้าถึงจะเห็นภาษาใหม่จริง
      if (isAuthenticated) {
        try {
          await apiFetch('/users/me', { method: 'PATCH', json: { language: lang } })
        } catch {
          // non-blocking: สลับ UI ต่อแม้ backend sync ล้มเหลว (Accept-Language header เป็น fallback)
        }
      }
      // 3. สลับ UI — ตอนนี้ backend sync เสร็จแล้ว (หรือ fail แบบ non-blocking) query ที่ refetch ตามมาจะได้ค่าใหม่ถูกต้อง
      await i18n.changeLanguage(lang)
    },
    [i18n, isAuthenticated],
  )

  return {
    language: i18n.language as SupportedLocale,
    changeLanguage,
  }
}
