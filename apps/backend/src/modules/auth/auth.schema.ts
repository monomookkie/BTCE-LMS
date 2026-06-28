import { z } from 'zod'
import { userResponseSchema } from '@btec-lms/shared'

export const meResponseSchema = userResponseSchema.extend({
  mustChangePassword: z.boolean(),
})

export const authSuccessSchema = z.object({ message: z.literal('ok') })

export type MeResponse = z.infer<typeof meResponseSchema>
