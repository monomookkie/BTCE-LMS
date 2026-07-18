import { z } from 'zod'

export const enrollStatusSchema = z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'])

export const enrollmentResponseSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  courseId: z.string().cuid(),
  courseTitle: z.string(),
  status: enrollStatusSchema,
  progress: z.number().int().min(0).max(100),
  completedMaterials: z.array(z.string()),
  // 2C-3: snapshot จาก course.accessType ตอน enroll — POSITION_BASED=true, PUBLIC=false
  // (ไม่เปลี่ยนย้อนหลังตาม accessType-lock ของ course — ดู 2C-2)
  isMandatory: z.boolean(),
  // จำนวนครั้งสอบ quiz พิเศษที่ ADMIN ให้เพิ่ม — บวกเพิ่มจาก quiz.maxAttempts เฉพาะ enrollment นี้
  bonusQuizAttempts: z.number().int().min(0),
  assignedAt: z.string().datetime(),
  dueAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

// USER เริ่มเรียนเอง — PUBLIC เข้าได้ทุกคน, POSITION_BASED ต้อง position ตรงกับที่ course ผูกไว้ (2C-3)
export const selfEnrollInputSchema = z.object({
  courseId: z.string().cuid(),
})

// ADMIN ตั้ง/เคลียร์วันครบกำหนดของ enrollment ที่มีอยู่แล้ว (แทนที่ assignEnrollment เดิมที่ถูกลบใน 2C-3)
export const setEnrollmentDueDateInputSchema = z.object({
  dueAt: z.string().datetime().nullable(),
})

export type EnrollStatus = z.infer<typeof enrollStatusSchema>
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>
export type SelfEnrollInput = z.infer<typeof selfEnrollInputSchema>
export type SetEnrollmentDueDateInput = z.infer<typeof setEnrollmentDueDateInputSchema>
