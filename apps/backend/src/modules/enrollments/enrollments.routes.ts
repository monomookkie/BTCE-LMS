import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { enrollmentResponseSchema, selfEnrollInputSchema, setEnrollmentDueDateInputSchema } from '@btec-lms/shared'
import {
  enrollmentListQuerySchema,
  enrollmentParamsSchema,
  completeMaterialParamsSchema,
  materialProgressInputSchema,
  materialProgressResponseSchema,
  materialHeartbeatInputSchema,
} from './enrollments.schema.js'
import {
  selfEnroll,
  setEnrollmentDueDate,
  grantQuizAttempt,
  listEnrollments,
  listMyEnrollments,
  getEnrollment,
  markMaterialComplete,
  cancelEnrollment,
  openMaterial,
  updateMaterialProgress,
  getMaterialProgress,
  markEmbedFailed,
  recordMaterialHeartbeat,
} from './enrollments.service.js'
import { t, resolveLocale } from '../../lib/i18n.js'

const enrollmentsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const enrollmentListResponseSchema = z.object({
    data: z.array(enrollmentResponseSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
  })

  // POST /enrollments/self — USER self-enroll (PUBLIC ใครก็ได้, POSITION_BASED ต้อง position ตรง — 2C-3)
  server.post('/self', {
    preHandler: [app.verifyJwt],
    schema: {
      body: selfEnrollInputSchema,
      response: { 201: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await selfEnroll(
      app.prisma,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.code(201).send(enrollment)
  })

  // GET /enrollments — ADMIN list all
  server.get('/', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      querystring: enrollmentListQuerySchema,
      response: { 200: enrollmentListResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const result = await listEnrollments(app.prisma, req.query, req.user.id, locale, req.ip)
    return reply.send(result)
  })

  // GET /enrollments/me — any authenticated user (own only)
  server.get('/me', {
    preHandler: [app.verifyJwt],
    schema: {
      querystring: enrollmentListQuerySchema,
      response: { 200: enrollmentListResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const result = await listMyEnrollments(app.prisma, req.user.id, req.query, locale)
    return reply.send(result)
  })

  // GET /enrollments/:id — owner or ADMIN
  server.get('/:id', {
    preHandler: [app.verifyJwt],
    schema: {
      params: enrollmentParamsSchema,
      response: { 200: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await getEnrollment(
      app.prisma,
      req.params.id,
      req.user.id,
      req.user.role,
      locale,
      req.ip,
    )
    return reply.send(enrollment)
  })

  // POST /enrollments/:id/materials/:materialId/open — USER (own only)
  // Tier 2: บันทึกว่าเปิดสื่อการเรียนแล้ว (idempotent — เปิดซ้ำไม่ reset)
  server.post('/:id/materials/:materialId/open', {
    preHandler: [app.verifyJwt],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      params: completeMaterialParamsSchema,
      response: { 200: materialProgressResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const progress = await openMaterial(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      locale,
    )
    return reply.send(progress)
  })

  // POST /enrollments/:id/materials/:materialId/embed-failed — USER (own only)
  // client รายงานว่า YouTube embed โหลดไม่สำเร็จ (network/CSP/timeout) — gate จะ fallback เป็น time-gate แบบ LINK
  server.post('/:id/materials/:materialId/embed-failed', {
    preHandler: [app.verifyJwt],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      params: completeMaterialParamsSchema,
      response: { 200: materialProgressResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const progress = await markEmbedFailed(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      locale,
    )
    return reply.send(progress)
  })

  // POST /enrollments/:id/materials/:materialId/heartbeat — USER (own only)
  // Tier 2: client ยิงทุก ~HEARTBEAT_INTERVAL_SECONDS วิ ระหว่างอยู่หน้า material + tab visible เท่านั้น
  // (ดู useTimeGate ฝั่ง frontend) — สะสม activeSeconds ใช้แทน wall-clock diff จาก openedAt เดิม
  server.post('/:id/materials/:materialId/heartbeat', {
    preHandler: [app.verifyJwt],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      params: completeMaterialParamsSchema,
      body: materialHeartbeatInputSchema,
      response: { 200: materialProgressResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const progress = await recordMaterialHeartbeat(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      req.body.deltaSeconds,
      locale,
    )
    return reply.send(progress)
  })

  // GET /enrollments/:id/materials/:materialId/progress — USER (own only)
  // hydrate % ที่ดูถึงแล้วตอนโหลดหน้าใหม่ (default { watchedPercent: 0, openedAt: null } ถ้ายังไม่เคยเปิด)
  server.get('/:id/materials/:materialId/progress', {
    preHandler: [app.verifyJwt],
    schema: {
      params: completeMaterialParamsSchema,
      response: { 200: materialProgressResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const progress = await getMaterialProgress(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      locale,
    )
    return reply.send(progress)
  })

  // POST /enrollments/:id/materials/:materialId/progress — USER (own only)
  // Tier 3: อัปเดต % ที่ดูวิดีโอถึง (เก็บค่าสูงสุด กันไถถอยหลัง)
  server.post('/:id/materials/:materialId/progress', {
    preHandler: [app.verifyJwt],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      params: completeMaterialParamsSchema,
      body: materialProgressInputSchema,
      response: { 200: materialProgressResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const progress = await updateMaterialProgress(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      req.body.watchedPercent,
      req.body.durationSeconds,
      locale,
    )
    return reply.send(progress)
  })

  // POST /enrollments/:id/complete-material/:materialId — USER (own only)
  server.post('/:id/complete-material/:materialId', {
    preHandler: [app.verifyJwt],
    schema: {
      params: completeMaterialParamsSchema,
      response: { 200: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await markMaterialComplete(
      app.prisma,
      req.params.id,
      req.params.materialId,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send(enrollment)
  })

  // PATCH /enrollments/:id — ADMIN ตั้ง/เคลียร์ dueAt เท่านั้น (แทนที่ assignEnrollment ที่ลบไปใน 2C-3)
  server.patch('/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: enrollmentParamsSchema,
      body: setEnrollmentDueDateInputSchema,
      response: { 200: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await setEnrollmentDueDate(
      app.prisma,
      req.params.id,
      req.body,
      req.user.id,
      locale,
      req.ip,
    )
    return reply.send(enrollment)
  })

  // POST /enrollments/:id/grant-quiz-attempt — ADMIN ให้สิทธิ์สอบ quiz เพิ่ม 1 ครั้งเป็นกรณีพิเศษ
  // (เช่น สอบไม่ผ่านครบ maxAttempts แต่อยากให้โอกาสอีก) — บวกเพิ่มเฉพาะ enrollment นี้ ไม่กระทบ user คนอื่น
  server.post('/:id/grant-quiz-attempt', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: enrollmentParamsSchema,
      response: { 200: enrollmentResponseSchema },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const enrollment = await grantQuizAttempt(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send(enrollment)
  })

  // DELETE /enrollments/:id — ADMIN cancel enrollment
  server.delete('/:id', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      params: enrollmentParamsSchema,
      response: { 200: z.object({ message: z.string() }) },
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    await cancelEnrollment(app.prisma, req.params.id, req.user.id, locale, req.ip)
    return reply.send({ message: t('success.enrollment.cancelled', undefined, locale) })
  })
}

export default enrollmentsRoutes
