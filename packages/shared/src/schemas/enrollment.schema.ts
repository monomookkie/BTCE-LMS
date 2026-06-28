import { z } from 'zod'

export const enrollStatusSchema = z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'])

export const enrollmentResponseSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  courseId: z.string().cuid(),
  status: enrollStatusSchema,
  progress: z.number().int().min(0).max(100),
  completedMaterials: z.array(z.string()),
  assignedAt: z.string().datetime(),
  dueAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

// ADMIN/MANAGER assign user เข้า course
export const assignEnrollmentInputSchema = z.object({
  userId: z.string().cuid(),
  courseId: z.string().cuid(),
  dueAt: z.string().datetime().optional(),
})

// USER ลงทะเบียนเอง (ถ้า course.allowSelfEnroll)
export const selfEnrollInputSchema = z.object({
  courseId: z.string().cuid(),
})

export type EnrollStatus = z.infer<typeof enrollStatusSchema>
export type EnrollmentResponse = z.infer<typeof enrollmentResponseSchema>
export type AssignEnrollmentInput = z.infer<typeof assignEnrollmentInputSchema>
export type SelfEnrollInput = z.infer<typeof selfEnrollInputSchema>
