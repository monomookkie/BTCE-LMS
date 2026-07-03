import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { updateAnnouncementInputSchema } from '@btec-lms/shared'
import {
  announcementParamsSchema,
  announcementListQuerySchema,
} from './announcements.schema.js'
import {
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from './announcements.service.js'
import { getStorage } from '../../lib/storage.js'
import { badRequest } from '../../lib/errors.js'
import { t, resolveLocale } from '../../lib/i18n.js'
import { createAnnouncementInputSchema } from '@btec-lms/shared'
import { randomUUID } from 'node:crypto'

// PDF + image only (ห้าม zip/exe/etc.)
const ALLOWED_ANNOUNCEMENT_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]

const announcementsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ─── GET /announcements ───────────────────────────────────────────────────────
  // Any authenticated user; USER sees PUBLISHED only, ADMIN sees all
  // No route-level response schema — service handles role-based serialization (Convention #12)
  server.get('/announcements', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: announcementListQuerySchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listAnnouncements(app.prisma, req.user.role, req.query, locale, getStorage())
  })

  // ─── GET /announcements/:id ───────────────────────────────────────────────────
  // USER: only PUBLISHED (service returns 404 for DRAFT); ADMIN: any status
  server.get('/announcements/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: announcementParamsSchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getAnnouncement(app.prisma, req.params.id, req.user.role, locale, getStorage())
  })

  // ─── POST /announcements — multipart (file optional) ─────────────────────────
  // ADMIN only; file: PDF or image ≤ 5 MB (global multipart limit)
  // 10/min per-route cap: กัน ADMIN account ถูก compromise แล้ว abuse storage
  server.post('/announcements', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      response: { 201: z.object({}).passthrough() }, // admin shape — passthrough, serializeByRole handles stripping
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)

    const fields: Record<string, string> = {}
    let fileKey: string | null = null

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!ALLOWED_ANNOUNCEMENT_MIME.includes(part.mimetype)) {
          await part.toBuffer()
          throw badRequest(t('error.announcement.mimeNotAllowed', { mimeType: part.mimetype }, locale))
        }
        const buffer = await part.toBuffer()
        const ext = (part.filename ?? '').split('.').pop() ?? ''
        const filename = ext ? `${randomUUID()}.${ext}` : randomUUID()
        const result = await getStorage().upload(buffer, 'announcements', filename, part.mimetype)
        fileKey = result.fileKey
      } else {
        fields[part.fieldname] = part.value as string
      }
    }

    const parsed = createAnnouncementInputSchema.safeParse({
      titleEn: fields['titleEn'],
      titleTh: fields['titleTh'] ?? undefined,
      contentEn: fields['contentEn'],
      contentTh: fields['contentTh'] ?? undefined,
      type: fields['type'] ?? undefined,
      link: fields['link'] ?? undefined,
      status: fields['status'] ?? undefined,
    })
    if (!parsed.success) {
      throw badRequest(t('error.announcement.invalidMetadata', { detail: parsed.error.message }, locale))
    }

    const announcement = await createAnnouncement(
      app.prisma,
      req.user.id,
      parsed.data,
      fileKey,
      locale,
      getStorage(),
      req.ip,
    )
    return reply.code(201).send(announcement)
  })

  // ─── PATCH /announcements/:id — JSON body ────────────────────────────────────
  // ADMIN only; update content / publish / unpublish (no file replacement)
  server.patch('/announcements/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: announcementParamsSchema,
      body: updateAnnouncementInputSchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return updateAnnouncement(
      app.prisma,
      req.params.id,
      req.user.id,
      req.body,
      locale,
      getStorage(),
      req.ip,
    )
  })

  // ─── DELETE /announcements/:id ────────────────────────────────────────────────
  // ADMIN only; soft delete
  server.delete('/announcements/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: announcementParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await deleteAnnouncement(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send({ message: t('success.announcement.deleted', undefined, locale) })
  })
}

export default announcementsRoutes
