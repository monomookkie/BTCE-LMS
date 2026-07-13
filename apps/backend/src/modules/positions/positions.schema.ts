import { z } from 'zod'

export const positionParamsSchema = z.object({ id: z.string().cuid() })
