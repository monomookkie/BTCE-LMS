import { z } from 'zod'

// ─── Cert status (computed, not stored) ────────────────────────────────────

export const certStatusSchema = z.enum(['valid', 'expiring-soon', 'expired', 'revoked'])
export type CertStatus = z.infer<typeof certStatusSchema>

// ─── Internal certificate — Convention #12 public/admin split ──────────────

const certBaseFields = {
  id: z.string().cuid(),
  certNumber: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),
  score: z.number().int(),
  status: certStatusSchema,
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
}

// USER ดูของตัวเอง — ไม่เห็น verifyHash, fileKey, userId ของคนอื่น
export const certificatePublicResponseSchema = z.object(certBaseFields)
export type CertificatePublicResponse = z.infer<typeof certificatePublicResponseSchema>

// ADMIN/MANAGER — superset: + identifiers + revoke info
export const certificateAdminResponseSchema = z.object({
  ...certBaseFields,
  enrollmentId: z.string(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  verifyHash: z.string(),
  fileKey: z.string().nullable(),
  revokedAt: z.string().datetime().nullable(),
})
export type CertificateAdminResponse = z.infer<typeof certificateAdminResponseSchema>

// ─── Public verify endpoint — ห้าม PII เกิน (PDPA) ─────────────────────────
// ไม่คืน email, employeeId, userId — แค่ holderName (display name) + course + dates

export const certificateVerifyResponseSchema = z.object({
  certNumber: z.string(),
  holderName: z.string(),   // ชื่อผู้เรียน เท่านั้น (ไม่มี email / employeeId)
  courseName: z.string(),   // localized
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  status: certStatusSchema,
})
export type CertificateVerifyResponse = z.infer<typeof certificateVerifyResponseSchema>

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

export const revokeCertInputSchema = z.object({
  reason: z.string().max(500).optional(),
})
export type RevokeCertInput = z.infer<typeof revokeCertInputSchema>
