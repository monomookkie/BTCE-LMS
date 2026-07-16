import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  materialAdminResponseSchema,
  createLinkMaterialInputSchema,
  createFileMaterialMetaSchema,
  updateMaterialInputSchema,
  reorderMaterialsInputSchema,
} from '@btec-lms/shared'
import { materialCourseParamsSchema, materialParamsSchema } from './materials.schema.js'
import {
  listMaterials,
  createLinkMaterial,
  createFileMaterial,
  updateMaterial,
  replaceMaterialFile,
  reorderMaterials,
  softDeleteMaterial,
} from './materials.service.js'
import { getStorage } from '../../lib/storage.js'
import { badRequest } from '../../lib/errors.js'
import { t, resolveLocale } from '../../lib/i18n.js'
import { randomUUID } from 'node:crypto'

// MIME types ที่อนุญาตต่อ material type — ป้องกันอัปโหลดไฟล์อันตราย
// DOC ไม่อยู่ในนี้แล้ว — เปลี่ยนเป็นลิงก์ (เช่น Google Drive) แทนการอัปโหลดตรง เพราะบราวเซอร์ไม่มี
// viewer ให้ .doc/.docx ในตัว (เปิดแล้วดาวน์โหลดเสมอ) และเจอปัญหาการเก็บไฟล์ raw บน Cloudinary มาก่อน
const ALLOWED_MIME: Record<string, string[]> = {
  PDF: ['application/pdf'],
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
}

const materialsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // GET /courses/:courseId/materials — ADMIN หรือ enrolled USER
  // response schema ไม่ declare ที่ route เพราะ schema ขึ้นกับ role (service จัดการ)
  server.get('/:courseId/materials', {
    preHandler: [app.verifyJwt],
    schema: {
      params: materialCourseParamsSchema,
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return listMaterials(app.prisma, req.params.courseId, getStorage(), req.user.id, locale, req.ip, req.user.role)
  })

  // POST /courses/:courseId/materials/link — ADMIN (VIDEO / LINK via JSON)
  // ต้องอยู่ก่อน /:courseId/materials/:materialId เพื่อให้ "link" ไม่ถูก match เป็น materialId
  server.post('/:courseId/materials/link', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: materialCourseParamsSchema,
      body: createLinkMaterialInputSchema,
      response: { 201: materialAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const material = await createLinkMaterial(
      app.prisma,
      req.params.courseId,
      req.body,
      req.user.id,
      getStorage(),
      locale,
      req.ip,
    )
    return reply.code(201).send(material)
  })

  // PATCH /courses/:courseId/materials/reorder — ADMIN
  // ต้องอยู่ก่อน /:courseId/materials/:materialId
  server.patch('/:courseId/materials/reorder', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: materialCourseParamsSchema,
      body: reorderMaterialsInputSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await reorderMaterials(app.prisma, req.params.courseId, req.body, req.user.id, locale, req.ip)
    return reply.send({ message: t('success.material.reordered', undefined, locale) })
  })

  // POST /courses/:courseId/materials — ADMIN (PDF / IMAGE / DOC via multipart)
  server.post('/:courseId/materials', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: materialCourseParamsSchema,
      response: { 201: materialAdminResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const data = await req.file()
    if (!data) throw badRequest(t('error.file.noFile', undefined, locale))

    // parse metadata จาก multipart fields
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.fields)) {
      if (value && typeof value === 'object' && 'value' in value) {
        fields[key] = String((value as { value: unknown }).value)
      }
    }

    const metaParse = createFileMaterialMetaSchema.safeParse({
      type: fields['type'],
      titleEn: fields['titleEn'],
      titleTh: fields['titleTh'],
      order: fields['order'] != null ? Number(fields['order']) : undefined,
    })
    if (!metaParse.success) {
      throw badRequest(t('error.material.invalidMetadata', { detail: metaParse.error.message }, locale))
    }

    const mimeType = data.mimetype
    const allowedMimes = ALLOWED_MIME[metaParse.data.type]
    if (!allowedMimes?.includes(mimeType)) {
      throw badRequest(t('error.material.mimeNotAllowed', { mimeType, type: metaParse.data.type }, locale))
    }

    const buffer = await data.toBuffer()
    // UUID-based filename ป้องกัน path traversal / special chars จาก user input
    const ext = (data.filename ?? '').split('.').pop() ?? ''
    const filename = ext ? `${randomUUID()}.${ext}` : randomUUID()

    const material = await createFileMaterial(
      app.prisma,
      req.params.courseId,
      buffer,
      filename,
      mimeType,
      metaParse.data,
      req.user.id,
      getStorage(),
      locale,
      req.ip,
    )
    return reply.code(201).send(material)
  })

  // PATCH /courses/:courseId/materials/:materialId/file — ADMIN
  // แทนที่ไฟล์เดิมของ material ประเภท PDF/IMAGE/DOC (+ แก้ชื่อได้พร้อมกันในคำขอเดียว) — ไฟล์บังคับแนบเสมอ
  // (แก้แค่ชื่ออย่างเดียวใช้ PATCH /:materialId แบบ JSON เดิมที่มีอยู่แล้วแทน)
  // ต้องอยู่ก่อน /:materialId เฉยๆ กัน "file" ถูกตีความเป็น sub-resource ผิด route
  server.patch('/:courseId/materials/:materialId/file', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: materialParamsSchema,
      response: { 200: materialAdminResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    const data = await req.file()
    if (!data) throw badRequest(t('error.file.noFile', undefined, locale))

    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.fields)) {
      if (value && typeof value === 'object' && 'value' in value) {
        fields[key] = String((value as { value: unknown }).value)
      }
    }

    const fieldsParse = z.object({
      titleEn: z.string().min(1).max(200).optional(),
      titleTh: z.string().max(200).nullable().optional(),
    }).safeParse({
      titleEn: fields['titleEn'] || undefined,
      titleTh: fields['titleTh'] ?? undefined,
    })
    if (!fieldsParse.success) {
      throw badRequest(t('error.material.invalidMetadata', { detail: fieldsParse.error.message }, locale))
    }

    const allAllowedMimes = Object.values(ALLOWED_MIME).flat()
    if (!allAllowedMimes.includes(data.mimetype)) {
      throw badRequest(t('error.material.mimeNotAllowed', { mimeType: data.mimetype, type: 'PDF/IMAGE/DOC' }, locale))
    }
    const buffer = await data.toBuffer()
    const ext = (data.filename ?? '').split('.').pop() ?? ''
    const filename = ext ? `${randomUUID()}.${ext}` : randomUUID()

    return replaceMaterialFile(
      app.prisma,
      req.params.courseId,
      req.params.materialId,
      fieldsParse.data,
      { buffer, filename, mimeType: data.mimetype },
      req.user.id,
      getStorage(),
      locale,
      req.ip,
    )
  })

  // PATCH /courses/:courseId/materials/:materialId — ADMIN
  server.patch('/:courseId/materials/:materialId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: materialParamsSchema,
      body: updateMaterialInputSchema,
      response: { 200: materialAdminResponseSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return updateMaterial(
      app.prisma,
      req.params.courseId,
      req.params.materialId,
      req.body,
      req.user.id,
      getStorage(),
      locale,
      req.ip,
    )
  })

  // DELETE /courses/:courseId/materials/:materialId — ADMIN
  server.delete('/:courseId/materials/:materialId', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: materialParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await softDeleteMaterial(
      app.prisma,
      req.params.courseId,
      req.params.materialId,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send({ message: t('success.material.deleted', undefined, locale) })
  })
}

export default materialsRoutes
