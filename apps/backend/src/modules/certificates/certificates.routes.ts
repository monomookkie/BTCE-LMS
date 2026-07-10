import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  externalCertResponseSchema,
  createExternalCertInputSchema,
} from '@btec-lms/shared'
import { extCertParamsSchema, extCertListQuerySchema } from './certificates.schema.js'
import {
  listExternalCertsScoped,
  getExternalCert,
  createExternalCert,
  deleteExternalCert,
} from './certificates.service.js'
import { getStorage } from '../../lib/storage.js'
import { badRequest } from '../../lib/errors.js'
import { t, resolveLocale } from '../../lib/i18n.js'
import { randomUUID } from 'node:crypto'

// MIME types ที่อนุญาตสำหรับ external certificate — PDF หรือรูปภาพเท่านั้น
const ALLOWED_EXT_CERT_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]

const certificatesRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ─── GET /external-certs ───────────────────────────────────────────────────
  // USER: own external certs เท่านั้น (query.userId ignored)
  // ADMIN: userId ใดก็ได้ (audited)
  server.get('/external-certs', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: extCertListQuerySchema,
      response: { 200: z.array(externalCertResponseSchema) },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listExternalCertsScoped(
      app.prisma,
      req.user.id,
      req.user.role,
      req.query.userId,
      getStorage(),
      locale,
      req.ip,
    )
  })

  // ─── POST /external-certs — multipart (file optional) ─────────────────────
  // รับ metadata เป็น multipart fields + optional file (PDF/image)
  // ส่ง multipart/form-data เสมอ แม้ไม่มีไฟล์
  server.post('/external-certs', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    preHandler: [app.verifyJwt],
    schema: {
      response: { 201: externalCertResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)

    // ใช้ req.parts() แทน req.file() เพื่อรองรับ optional file upload
    const fields: Record<string, string> = {}
    let fileKey: string | null = null

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!ALLOWED_EXT_CERT_MIME.includes(part.mimetype)) {
          // ต้อง consume stream ก่อน throw ไม่งั้น multipart parser ค้าง
          await part.toBuffer()
          throw badRequest(t('error.externalCert.mimeNotAllowed', { mimeType: part.mimetype }, locale))
        }
        const buffer = await part.toBuffer()
        const ext = (part.filename ?? '').split('.').pop() ?? ''
        const filename = ext ? `${randomUUID()}.${ext}` : randomUUID()
        const result = await getStorage().upload(buffer, 'certificates', filename, part.mimetype)
        fileKey = result.fileKey
      } else {
        fields[part.fieldname] = part.value as string
      }
    }

    const metaParse = createExternalCertInputSchema.safeParse({
      title: fields['title'],
      issuer: fields['issuer'],
      issuedAt: fields['issuedAt'],
      expiresAt: fields['expiresAt'] ?? undefined,
    })
    if (!metaParse.success) {
      throw badRequest(t('error.externalCert.invalidMetadata', { detail: metaParse.error.message }, locale))
    }

    const cert = await createExternalCert(
      app.prisma,
      req.user.id,
      metaParse.data,
      fileKey,
      getStorage(),
      req.ip,
    )
    return reply.code(201).send(cert)
  })

  // ─── GET /external-certs/:id ───────────────────────────────────────────────
  // IDOR-guarded in service: 404 if not owner
  server.get('/external-certs/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: extCertParamsSchema,
      response: { 200: externalCertResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getExternalCert(app.prisma, req.params.id, req.user.id, getStorage(), locale)
  })

  // ─── DELETE /external-certs/:id ────────────────────────────────────────────
  // Soft delete — IDOR-guarded in service: 404 if not owner
  server.delete('/external-certs/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: extCertParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteExternalCert(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send({ message: t('success.externalCert.deleted', undefined, locale) })
  })
}

export default certificatesRoutes
