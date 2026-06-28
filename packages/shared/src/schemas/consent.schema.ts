import { z } from 'zod'

export const consentInputSchema = z.object({
  type: z.enum(['PDPA_BASIC', 'MARKETING']),
  granted: z.boolean(),
  version: z.string().min(1).max(20),
})

export type ConsentInput = z.infer<typeof consentInputSchema>
