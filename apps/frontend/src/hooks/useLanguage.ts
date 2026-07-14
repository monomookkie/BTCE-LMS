import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type { SupportedLocale } from '../i18n/index.js'
import { persistLanguage } from '../i18n/index.js'
import { apiFetch } from '../lib/api.js'
import { AUTH_QUERY_KEY } from './useAuth.js'

interface UseLanguageOptions {
  isAuthenticated?: boolean
}

interface UseLanguageReturn {
  language: SupportedLocale
  changeLanguage: (lang: SupportedLocale) => Promise<void>
}

export function useLanguage({ isAuthenticated = false }: UseLanguageOptions = {}): UseLanguageReturn {
  const { i18n } = useTranslation()
  const qc = useQueryClient()

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
      // 4. auth/me query key ไม่ผูกกับ i18n.language (ไม่งั้น login/logout mutation ต้อง setQueryData หลาย key)
      // และตั้ง refetchOnMount: false ไว้เพื่อไม่ให้ re-fetch ทุก SPA navigation — ต้อง invalidate เองตรงนี้
      // ไม่งั้น user.position (localized field) ค้างภาษาเดิมจนกว่าจะ reload หน้าหรือ staleTime (5 นาที) หมดอายุ
      if (isAuthenticated) {
        void qc.invalidateQueries({ queryKey: AUTH_QUERY_KEY })
      }
    },
    [i18n, isAuthenticated, qc],
  )

  return {
    language: i18n.language as SupportedLocale,
    changeLanguage,
  }
}
