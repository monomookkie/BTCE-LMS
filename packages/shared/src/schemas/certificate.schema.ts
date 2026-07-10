import { z } from 'zod'

// ─── External certificate (user-uploaded) ──────────────────────────────────

export const externalCertResponseSchema = z.object({
  id: z.string().cuid(),
  title: z.string(),
  issuer: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  fileKey: z.string().nullable(),
  signedUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
})
export type ExternalCertResponse = z.infer<typeof externalCertResponseSchema>

// ─── Input schemas ──────────────────────────────────────────────────────────

export const createExternalCertInputSchema = z.object({
  title: z.string().min(1).max(200),
  issuer: z.string().min(1).max(200),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
})
export type CreateExternalCertInput = z.infer<typeof createExternalCertInputSchema>
