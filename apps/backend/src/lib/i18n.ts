import type { FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import enDict from './i18n/en.json' with { type: 'json' }
import thDict from './i18n/th.json' with { type: 'json' }

export type Locale = 'en' | 'th'

const translations: Record<Locale, Record<string, string>> = {
  en: enDict as Record<string, string>,
  th: thDict as Record<string, string>,
}

/**
 * แปล i18n key เป็นข้อความตาม locale
 * Interpolation: "Maximum attempts ({{count}}) reached" + { count: 3 } → "Maximum attempts (3) reached"
 * Fallback chain: locale dict → en dict → key itself
 */
export function t(
  key: string,
  vars?: Record<string, string | number>,
  locale: Locale = 'en',
): string {
  const dict = translations[locale]
  const template = dict[key] ?? translations.en[key] ?? key
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''))
}

/**
 * กำหนด locale จาก request ตามลำดับ priority:
 * 1. DB lookup ด้วย req.user.id (ถ้า login แล้ว) — เปลี่ยนภาษามีผลทันทีโดยไม่ต้อง refresh token
 * 2. Accept-Language header
 * 3. 'en' (default)
 */
export async function resolveLocale(req: FastifyRequest, prisma: PrismaClient): Promise<Locale> {
  // 1. ดึงจาก DB เพื่อให้ reflect การเปลี่ยนภาษากลาง session ได้ทันที
  const userId = (req.user as { id?: string } | undefined)?.id
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { language: true },
    })
    const lang = user?.language
    if (lang === 'th' || lang === 'en') return lang
  }

  // 2. Accept-Language header — match 'th' prefix (th, th-TH, th-TH,en;q=0.9 ...)
  const header = (req.headers['accept-language'] ?? '').toLowerCase()
  if (/\bth\b/.test(header)) return 'th'

  // 3. default
  return 'en'
}

/**
 * เลือก field ตาม locale พร้อม fallback:
 * locale=th แต่ thValue ว่าง → ใช้ enValue
 * locale=en → ใช้ enValue เสมอ
 */
export function localizeField(
  enValue: string,
  thValue: string | null | undefined,
  locale: Locale,
): string {
  if (locale === 'th' && thValue) return thValue
  return enValue
}
