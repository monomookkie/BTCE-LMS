import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { serializeByRole, isAdminRole } from './roleResponse.js'
import { coursePublicResponseSchema, courseAdminResponseSchema } from '@btec-lms/shared'

// ─── isAdminRole ───────────────────────────────────────────────────────────

describe('isAdminRole()', () => {
  it('ADMIN → true', () => expect(isAdminRole('ADMIN')).toBe(true))
  it('MANAGER → true', () => expect(isAdminRole('MANAGER')).toBe(true))
  it('USER → false', () => expect(isAdminRole('USER')).toBe(false))
  it('empty string → false', () => expect(isAdminRole('')).toBe(false))
})

// ─── serializeByRole — strip via Zod .parse() ─────────────────────────────

describe('serializeByRole() — Zod .parse() strips extra fields', () => {
  // Minimal schemas ที่สะท้อน pattern จริง: admin เป็น superset ของ public
  const publicSchema = z.object({ title: z.string(), id: z.string() })
  const adminSchema = z.object({ title: z.string(), id: z.string(), titleEn: z.string() })

  // "poisoned" object — มี field เกิน (password) ที่ไม่ควรหลุดออก response ไม่ว่า role ไหน
  function makePoisoned() {
    return {
      id: 'cuid123',
      title: 'Localized Title',
      titleEn: 'English Title',
      password: 'super-secret',          // ห้ามหลุดออกเด็ดขาด
      internalFlag: true,                // ห้ามหลุดออก
      __proto__: { injected: 'evil' },   // prototype pollution attempt
    } as unknown as z.infer<typeof adminSchema>
  }

  it('USER role → ได้แค่ public fields; titleEn, password, internalFlag ถูก strip', () => {
    const result = serializeByRole('USER', makePoisoned(), adminSchema, publicSchema)

    expect(result.id).toBe('cuid123')
    expect(result.title).toBe('Localized Title')

    // raw bilingual field ต้องหาย
    expect('titleEn' in result).toBe(false)
    // sensitive fields ต้องหาย
    expect('password' in result).toBe(false)
    expect('internalFlag' in result).toBe(false)
  })

  it('ADMIN role → ได้ admin fields; password, internalFlag ยังถูก strip', () => {
    const result = serializeByRole('ADMIN', makePoisoned(), adminSchema, publicSchema)

    expect(result.id).toBe('cuid123')
    expect(result.title).toBe('Localized Title')
    // admin ต้องได้ raw field
    expect((result as z.infer<typeof adminSchema>).titleEn).toBe('English Title')

    // extra fields ที่ไม่อยู่ใน adminSchema ยังต้องหาย
    expect('password' in result).toBe(false)
    expect('internalFlag' in result).toBe(false)
  })

  it('MANAGER role → ได้ admin fields (MANAGER เป็น admin role)', () => {
    const result = serializeByRole('MANAGER', makePoisoned(), adminSchema, publicSchema)
    expect((result as z.infer<typeof adminSchema>).titleEn).toBe('English Title')
    expect('password' in result).toBe(false)
  })
})

// ─── serializeByRole — กับ courseSchema จริง ──────────────────────────────

describe('serializeByRole() — ใช้ coursePublicResponseSchema / courseAdminResponseSchema จริง', () => {
  const NOW = new Date().toISOString()
  // CUID v1 format: starts with 'c', ≥8 non-whitespace non-hyphen chars
  const VALID_CUID = 'cjld2cjxh0000qzrmn831i7rn'

  // สร้าง minimal course admin shape + poison fields
  const poisonedCourse = {
    id: VALID_CUID,
    title: 'Test Course',
    titleEn: 'Test Course EN',
    titleTh: null,
    category: 'Safety',
    categoryEn: 'Safety',
    categoryTh: null,
    description: null,
    descriptionEn: null,
    descriptionTh: null,
    status: 'PUBLISHED' as const,
    durationMin: null,
    passScore: 80,
    expiryMonths: null,
    allowSelfEnroll: false,
    createdById: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    // poison fields — ต้องไม่หลุดออก response ไม่ว่า role ไหน
    password: 'should-never-appear',
    internalAuditNote: 'classified',
    _rawSqlQuery: 'DROP TABLE users;',
  } as unknown as z.infer<typeof courseAdminResponseSchema>

  it('USER role → coursePublicResponseSchema strips titleEn/titleTh/categoryEn + poison', () => {
    const result = serializeByRole('USER', poisonedCourse, courseAdminResponseSchema, coursePublicResponseSchema)

    // localized fields ต้องอยู่
    expect(result.title).toBe('Test Course')
    expect(result.category).toBe('Safety')

    // raw bilingual ต้องหาย
    expect('titleEn' in result).toBe(false)
    expect('titleTh' in result).toBe(false)
    expect('categoryEn' in result).toBe(false)
    expect('categoryTh' in result).toBe(false)
    expect('descriptionEn' in result).toBe(false)
    expect('descriptionTh' in result).toBe(false)

    // poison ต้องหาย
    expect('password' in result).toBe(false)
    expect('internalAuditNote' in result).toBe(false)
  })

  it('ADMIN role → courseAdminResponseSchema คง raw bilingual; strips poison', () => {
    const result = serializeByRole('ADMIN', poisonedCourse, courseAdminResponseSchema, coursePublicResponseSchema)

    // raw bilingual ต้องอยู่
    expect((result as z.infer<typeof courseAdminResponseSchema>).titleEn).toBe('Test Course EN')
    expect((result as z.infer<typeof courseAdminResponseSchema>).categoryEn).toBe('Safety')

    // poison ต้องหาย
    expect('password' in result).toBe(false)
    expect('internalAuditNote' in result).toBe(false)
  })

  it('Zod strips ทุก field เกิน — ผลลัพธ์มีแค่ key ที่อยู่ใน schema เท่านั้น (USER)', () => {
    const result = serializeByRole('USER', poisonedCourse, courseAdminResponseSchema, coursePublicResponseSchema)
    const allowedKeys = Object.keys(coursePublicResponseSchema.shape)
    const resultKeys = Object.keys(result)
    // ทุก key ใน result ต้องอยู่ใน public schema
    for (const key of resultKeys) {
      expect(allowedKeys).toContain(key)
    }
  })

  it('Zod strips ทุก field เกิน — ผลลัพธ์มีแค่ key ที่อยู่ใน schema เท่านั้น (ADMIN)', () => {
    const result = serializeByRole('ADMIN', poisonedCourse, courseAdminResponseSchema, coursePublicResponseSchema)
    const allowedKeys = Object.keys(courseAdminResponseSchema.shape)
    const resultKeys = Object.keys(result)
    for (const key of resultKeys) {
      expect(allowedKeys).toContain(key)
    }
  })
})
