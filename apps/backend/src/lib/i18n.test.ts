import { describe, it, expect } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { t, resolveLocale, localizeField } from './i18n.js'
import type { FastifyRequest } from 'fastify'

// Minimal Fastify request stub
function makeReq(opts: {
  userId?: string
  acceptLanguage?: string
}): FastifyRequest {
  return {
    user: opts.userId != null ? { id: opts.userId, role: 'USER' } : undefined,
    headers: { 'accept-language': opts.acceptLanguage ?? '' },
  } as unknown as FastifyRequest
}

// Prisma stub — controls what language the DB returns
function makePrisma(language: string | null = 'en'): PrismaClient {
  return {
    user: {
      findUnique: async () => (language != null ? { language } : null),
    },
  } as unknown as PrismaClient
}

describe('t()', () => {
  it('returns English message for known key', () => {
    expect(t('error.user.notFound', undefined, 'en')).toBe('User not found')
  })

  it('returns Thai message for known key', () => {
    expect(t('error.user.notFound', undefined, 'th')).toBe('ไม่พบข้อมูลผู้ใช้')
  })

  it('falls back to key itself when not in any dict', () => {
    expect(t('totally.unknown.key')).toBe('totally.unknown.key')
  })

  it('interpolates {{vars}} correctly', () => {
    const msg = t('error.quiz.maxAttemptsReached', { count: 3 }, 'en')
    expect(msg).toBe('Maximum attempts (3) reached for this quiz')
  })

  it('interpolates in Thai', () => {
    const msg = t('error.quiz.maxAttemptsReached', { count: 5 }, 'th')
    expect(msg).toContain('5')
  })

  it('leaves missing var placeholder empty', () => {
    const msg = t('error.quiz.maxAttemptsReached', {}, 'en')
    expect(msg).toContain('()')
  })
})

describe('resolveLocale()', () => {
  it('returns th when DB has language=th', async () => {
    const locale = await resolveLocale(makeReq({ userId: 'u1' }), makePrisma('th'))
    expect(locale).toBe('th')
  })

  it('returns en when DB has language=en', async () => {
    const locale = await resolveLocale(makeReq({ userId: 'u1' }), makePrisma('en'))
    expect(locale).toBe('en')
  })

  it('falls back to Accept-Language header when user not authenticated', async () => {
    const locale = await resolveLocale(makeReq({ acceptLanguage: 'th-TH,en;q=0.9' }), makePrisma())
    expect(locale).toBe('th')
  })

  it('falls back to Accept-Language: th when DB returns null (user not found)', async () => {
    const locale = await resolveLocale(
      makeReq({ userId: 'u1', acceptLanguage: 'th' }),
      makePrisma(null),
    )
    expect(locale).toBe('th')
  })

  it('returns en for English Accept-Language with no user', async () => {
    const locale = await resolveLocale(makeReq({ acceptLanguage: 'en-US,en;q=0.9' }), makePrisma())
    expect(locale).toBe('en')
  })

  it('returns en when no user and no Accept-Language header', async () => {
    const locale = await resolveLocale(makeReq({}), makePrisma())
    expect(locale).toBe('en')
  })

  it('DB value takes priority over Accept-Language header', async () => {
    // User set language=en in DB but browser sends th
    const locale = await resolveLocale(
      makeReq({ userId: 'u1', acceptLanguage: 'th-TH' }),
      makePrisma('en'),
    )
    expect(locale).toBe('en')
  })

  it('language change is reflected immediately (no token refresh needed)', async () => {
    // Same req.user.id, different DB state — simulates user calling PATCH /users/me
    const req = makeReq({ userId: 'u1' })
    const before = await resolveLocale(req, makePrisma('en'))
    const after = await resolveLocale(req, makePrisma('th')) // DB updated, same JWT
    expect(before).toBe('en')
    expect(after).toBe('th')
  })
})

describe('localizeField()', () => {
  it('returns Thai value when locale=th and Thai exists', () => {
    expect(localizeField('Hello', 'สวัสดี', 'th')).toBe('สวัสดี')
  })

  it('falls back to English when locale=th but Thai is empty string', () => {
    expect(localizeField('Hello', '', 'th')).toBe('Hello')
  })

  it('falls back to English when locale=th but Thai is null', () => {
    expect(localizeField('Hello', null, 'th')).toBe('Hello')
  })

  it('falls back to English when locale=th but Thai is undefined', () => {
    expect(localizeField('Hello', undefined, 'th')).toBe('Hello')
  })

  it('returns English when locale=en regardless of Thai value', () => {
    expect(localizeField('Hello', 'สวัสดี', 'en')).toBe('Hello')
  })
})
