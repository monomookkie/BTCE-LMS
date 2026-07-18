import { z } from 'zod'
import { paginationQuerySchema, HEARTBEAT_MAX_DELTA_SECONDS } from '@btec-lms/shared'

export const enrollmentListQuerySchema = paginationQuerySchema.extend({
  userId: z.string().cuid().optional(),
  courseId: z.string().cuid().optional(),
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']).optional(),
})

export const enrollmentParamsSchema = z.object({
  id: z.string().cuid(),
})

export const completeMaterialParamsSchema = z.object({
  id: z.string().cuid(),         // enrollmentId
  materialId: z.string().cuid(),
})

export const materialProgressInputSchema = z.object({
  watchedPercent: z.number().int().min(0).max(100),
  // ความยาววิดีโอ (วินาที) จาก player.getDuration() — ส่งมาเพื่อคำนวณ time-ceiling กัน watchedPercent ปลอม
  // ถูก lock ที่ค่าแรกที่ server ได้รับ (ดู updateMaterialProgress) — ส่งมาไม่ตรงภายหลังจะไม่มีผล
  durationSeconds: z.number().positive().max(86400).optional(),
})

export const materialProgressResponseSchema = z.object({
  materialId: z.string().cuid(),
  openedAt: z.string().datetime().nullable(),
  watchedPercent: z.number().int().min(0).max(100),
  // true = YouTube embed โหลดไม่สำเร็จ (network/CSP/timeout) ฝั่ง client รายงานมา — gate จะ fallback เป็น time-gate แบบ LINK
  embedFailed: z.boolean(),
  // เวลาที่อยู่หน้าจริงสะสม (วินาที) — ใช้แทน wall-clock diff จาก openedAt สำหรับ time-gate (PDF/LINK/IMAGE/DOC + VIDEO fallback)
  activeSeconds: z.number().int().min(0),
})

// client ส่งทุก ~HEARTBEAT_INTERVAL_SECONDS วิ ระหว่างอยู่หน้า material + tab visible เท่านั้น (ดู useTimeGate)
export const materialHeartbeatInputSchema = z.object({
  deltaSeconds: z.number().int().min(1).max(HEARTBEAT_MAX_DELTA_SECONDS),
})

export type EnrollmentListQuery = z.infer<typeof enrollmentListQuerySchema>
export type MaterialProgressInput = z.infer<typeof materialProgressInputSchema>
export type MaterialProgressResponse = z.infer<typeof materialProgressResponseSchema>
export type MaterialHeartbeatInput = z.infer<typeof materialHeartbeatInputSchema>
