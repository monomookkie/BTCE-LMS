import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  certificateAdminResponseSchema,
  certificateVerifyResponseSchema,
  externalCertResponseSchema,
  createExternalCertInputSchema,
  revokeCertInputSchema,
} from '@btec-lms/shared'
import {
  certParamsSchema,
  certListQuerySchema,
  certVerifyParamsSchema,
  extCertParamsSchema,
  extCertListQuerySchema,
} from './certificates.schema.js'
import {
  listCertificates,
  getCertificate,
  revokeCertificate,
  generateCertPdf,
  verifyByHash,
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

  // ─── GET /certificates ─────────────────────────────────────────────────────
  // ADMIN/MANAGER: list all (filter by userId optional)
  // USER: own certs only (service ignores query.userId for USER role)
  // No response schema at route level — role-based serialization in service (Convention #12)
  server.get('/certificates', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: certListQuerySchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listCertificates(
      app.prisma,
      req.user.id,
      req.user.role,
      {
        page: req.query.page,
        limit: req.query.limit,
        ...(req.query.userId != null && { userId: req.query.userId }),
        ...(req.query.courseId != null && { courseId: req.query.courseId }),
        ...(req.query.status != null && { status: req.query.status }),
        ...(req.query.search != null && { search: req.query.search }),
      },
      locale,
    )
  })

  // ─── GET /certificates/:id/pdf ─────────────────────────────────────────────
  // ต้องอยู่ก่อน /:id เพื่อให้ static segment "pdf" ไม่ถูก match เป็น :id
  server.get('/certificates/:id/pdf', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    preHandler: [app.verifyJwt],
    schema: {
      params: certParamsSchema,
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const buffer = await generateCertPdf(
      app.prisma,
      req.params.id,
      req.user.id,
      req.user.role,
      locale,
    )
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="certificate-${req.params.id}.pdf"`)
      .send(buffer)
  })

  // ─── GET /certificates/:id ─────────────────────────────────────────────────
  // USER: IDOR-guarded (service returns 404 for other users' certs)
  // ADMIN/MANAGER: any cert; audited if viewing another user's cert
  // No response schema — role-based serialization in service (Convention #12)
  server.get('/certificates/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: certParamsSchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getCertificate(
      app.prisma,
      req.params.id,
      req.user.id,
      req.user.role,
      locale,
      req.ip,
    )
  })

  // ─── POST /certificates/:id/revoke — ADMIN only ────────────────────────────
  server.post('/certificates/:id/revoke', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: certParamsSchema,
      body: revokeCertInputSchema,
      response: { 200: certificateAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const cert = await revokeCertificate(
      app.prisma,
      req.params.id,
      req.user.id,
      req.body.reason,
      locale,
      req.ip,
    )
    return reply.send(cert)
  })

  // ─── GET /verify/:hash — PUBLIC (unauthenticated) ──────────────────────────
  // ไม่ต้อง login — ใช้ verifyHash (UUID) เพื่อ public certificate verification
  // resolveLocale ใช้ Accept-Language header เป็น fallback (req.user ไม่มี)
  server.get('/verify/:hash', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      params: certVerifyParamsSchema,
      response: { 200: certificateVerifyResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return verifyByHash(
      app.prisma,
      req.params.hash,
      locale,
      req.ip,
    )
  })

  // ─── GET /external-certs ───────────────────────────────────────────────────
  // USER: own external certs เท่านั้น (query.userId ignored)
  // ADMIN: userId ใดก็ได้ / MANAGER: เฉพาะ userId ใน dept ตัวเอง (service scoped + audited)
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
