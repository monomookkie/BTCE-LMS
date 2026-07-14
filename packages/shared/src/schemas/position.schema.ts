import { z } from 'zod'

// public: localized name เท่านั้น — ใช้บนหน้า self-registration (unauthenticated)
export const positionPublicResponseSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
})

// admin: raw bilingual fields สำหรับหน้า Manage Positions (edit form)
// userCount/courseCount (2C-5): ให้ admin เห็นก่อนตัดสินใจลบ/merge — ไม่ต้องยิง request เพิ่ม
export const positionAdminResponseSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
  nameEn: z.string(),
  nameTh: z.string().nullable(),
  userCount: z.number().int(),
  courseCount: z.number().int(),
  // สงวนไว้เฉพาะ ADMIN assign เอง — ไม่ขึ้นในหน้า self-register สาธารณะ (GET /positions filter ออก)
  // ไม่มี field นี้ใน create/updatePositionInputSchema — แก้ได้เฉพาะทาง backend/seed เท่านั้น (ตั้งใจ)
  isSystemOnly: z.boolean(),
})

export const createPositionInputSchema = z.object({
  nameEn: z.string().trim().min(1).max(100),
  nameTh: z.string().trim().max(100).optional(),
})

export const updatePositionInputSchema = z.object({
  nameEn: z.string().trim().min(1).max(100).optional(),
  nameTh: z.string().trim().max(100).optional(),
})

// 2C-5: รวม position ซ้ำ — ย้าย user + course ทั้งหมดจาก :id (source) ไป targetPositionId แล้วลบ source
export const mergePositionInputSchema = z.object({
  targetPositionId: z.string().cuid(),
})

export type PositionPublicResponse = z.infer<typeof positionPublicResponseSchema>
export type PositionAdminResponse = z.infer<typeof positionAdminResponseSchema>
export type CreatePositionInput = z.infer<typeof createPositionInputSchema>
export type UpdatePositionInput = z.infer<typeof updatePositionInputSchema>
export type MergePositionInput = z.infer<typeof mergePositionInputSchema>
