import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  materialResponseSchema,
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
  reorderMaterials,
  softDeleteMaterial,
} from './materials.service.js'
import { getStorage } from '../../lib/storage.js'
import { badRequest } from '../../lib/errors.js'
import { randomUUID } from 'node:crypto'

// MIME types ที่อนุญาตต่อ material type — ป้องกันอัปโหลดไฟล์อันตราย
const ALLOWED_MIME: Record<string, string[]> = {
  PDF: ['application/pdf'],
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  DOC: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
}

const materialsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // GET /courses/:courseId/materials — ADMIN/MANAGER
  server.get('/:courseId/materials', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: materialCourseParamsSchema,
      response: { 200: z.array(materialResponseSchema) },
    },
  }, async (req) => {
    return listMaterials(app.prisma, req.params.courseId, getStorage(), req.user.id, req.ip)
  })

  // POST /courses/:courseId/materials/link — ADMIN/MANAGER (VIDEO / LINK via JSON)
  // ต้องอยู่ก่อน /:courseId/materials/:materialId เพื่อให้ "link" ไม่ถูก match เป็น materialId
  server.post('/:courseId/materials/link', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: materialCourseParamsSchema,
      body: createLinkMaterialInputSchema,
      response: { 201: materialResponseSchema },
    },
  }, async (req, reply) => {
    const material = await createLinkMaterial(
      app.prisma,
      req.params.courseId,
      req.body,
      req.user.id,
      getStorage(),
      req.ip,
    )
    return reply.code(201).send(material)
  })

  // PATCH /courses/:courseId/materials/reorder — ADMIN/MANAGER
  // ต้องอยู่ก่อน /:courseId/materials/:materialId
  server.patch('/:courseId/materials/reorder', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: materialCourseParamsSchema,
      body: reorderMaterialsInputSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    await reorderMaterials(app.prisma, req.params.courseId, req.body, req.user.id, req.ip)
    return reply.send({ message: 'Materials reordered' })
  })

  // POST /courses/:courseId/materials — ADMIN/MANAGER (PDF / IMAGE / DOC via multipart)
  server.post('/:courseId/materials', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: materialCourseParamsSchema,
      response: { 201: materialResponseSchema },
    },
  }, async (req, reply) => {
    const data = await req.file()
    if (!data) throw badRequest('No file uploaded')

    // parse metadata จาก multipart fields
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(data.fields)) {
      if (value && typeof value === 'object' && 'value' in value) {
        fields[key] = String((value as { value: unknown }).value)
      }
    }

    const metaParse = createFileMaterialMetaSchema.safeParse({
      type: fields['type'],
      title: fields['title'],
      order: fields['order'] != null ? Number(fields['order']) : undefined,
    })
    if (!metaParse.success) {
      throw badRequest(`Invalid metadata: ${metaParse.error.message}`)
    }

    const mimeType = data.mimetype
    const allowedMimes = ALLOWED_MIME[metaParse.data.type]
    if (!allowedMimes?.includes(mimeType)) {
      throw badRequest(`File MIME type "${mimeType}" is not allowed for type ${metaParse.data.type}`)
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
      req.ip,
    )
    return reply.code(201).send(material)
  })

  // PATCH /courses/:courseId/materials/:materialId — ADMIN/MANAGER
  server.patch('/:courseId/materials/:materialId', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: materialParamsSchema,
      body: updateMaterialInputSchema,
      response: { 200: materialResponseSchema },
    },
  }, async (req) => {
    return updateMaterial(
      app.prisma,
      req.params.courseId,
      req.params.materialId,
      req.body,
      req.user.id,
      getStorage(),
      req.ip,
    )
  })

  // DELETE /courses/:courseId/materials/:materialId — ADMIN/MANAGER
  server.delete('/:courseId/materials/:materialId', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      params: materialParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    await softDeleteMaterial(
      app.prisma,
      req.params.courseId,
      req.params.materialId,
      req.user.id,
      req.ip,
    )
    return reply.send({ message: 'Material deleted' })
  })
}

export default materialsRoutes
