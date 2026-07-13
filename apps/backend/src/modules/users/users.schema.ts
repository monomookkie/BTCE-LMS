import { z } from 'zod'
import { paginationQuerySchema, roleSchema } from '@btec-lms/shared'

export const userListQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  positionId: z.string().cuid().optional(), // 2C-5: filter ตาม id จริง แทน string match เดิม
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
})

export const importResultSchema = z.object({
  created: z.number(),
  skipped: z.number(),
  errors: z.array(
    z.object({
      row: z.number(),
      email: z.string(),
      reason: z.string(),
    }),
  ),
  tempPasswords: z.array(
    z.object({
      email: z.string(),
      tempPassword: z.string(),
    }),
  ),
})

export type UserListQuery = z.infer<typeof userListQuerySchema>
export type ImportResult = z.infer<typeof importResultSchema>
