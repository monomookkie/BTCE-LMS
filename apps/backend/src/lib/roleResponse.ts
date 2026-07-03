import type { z } from 'zod'

// ADMIN เห็น raw bilingual fields; USER เห็นเฉพาะ localized
const ADMIN_ROLES = ['ADMIN'] as const
type AdminRole = (typeof ADMIN_ROLES)[number]

export function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role)
}

/**
 * เลือก schema ตาม role แล้ว parse data ทันที
 * - TAdmin เป็น superset ของ TPublic (มี raw bilingual fields เพิ่ม)
 * - Zod .parse() strip fields ที่ไม่อยู่ใน schema ออกอัตโนมัติ
 *
 * ใช้ใน service layer — route handler ไม่ต้อง if/else role เอง
 */
export function serializeByRole<TAdmin, TPublic>(
  role: string,
  data: TAdmin,
  adminSchema: z.ZodType<TAdmin>,
  publicSchema: z.ZodType<TPublic>,
): TAdmin | TPublic {
  if (isAdminRole(role)) {
    return adminSchema.parse(data)
  }
  return publicSchema.parse(data)
}
