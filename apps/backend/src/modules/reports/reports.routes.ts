import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import { dashboardSummarySchema, complianceListSchema } from '@btec-lms/shared'
import { complianceQuerySchema, complianceExportQuerySchema } from './reports.schema.js'
import {
  getDashboardSummary,
  getComplianceList,
  getComplianceCsv,
} from './reports.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const reportsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ─── GET /reports/dashboard — ADMIN / MANAGER ────────────────────────────────
  // MANAGER เห็นเฉพาะ scope ตัวเอง (department)
  server.get('/reports/dashboard', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      response: { 200: dashboardSummarySchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getDashboardSummary(app.prisma, req.user.id, req.user.role, locale)
  })

  // ─── GET /reports/compliance — ADMIN / MANAGER (paginated) ──────────────────
  // ADMIN: สามารถ filter ด้วย departmentId / courseId
  // MANAGER: department scope จาก req.user เท่านั้น (query.departmentId ถูก ignore)
  server.get('/reports/compliance', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    schema: {
      querystring: complianceQuerySchema,
      response: { 200: complianceListSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getComplianceList(app.prisma, req.user.id, req.user.role, req.query, locale)
  })

  // ─── GET /reports/compliance/export — CSV download ───────────────────────────
  // Rate limit เข้มกว่า global: 5 req/min (ดึง PII ก้อนใหญ่)
  // Audit log: REPORT_EXPORT บันทึก scope + row count ทุกครั้ง
  server.get('/reports/compliance/export', {
    preHandler: [app.requireRole(['ADMIN', 'MANAGER'])],
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
    schema: {
      querystring: complianceExportQuerySchema,
    },
  }, async (req, reply) => {
    const locale = await resolveLocale(req, app.prisma)
    const csv = await getComplianceCsv(
      app.prisma,
      req.user.id,
      req.user.role,
      req.query,
      locale,
      req.ip,
    )
    const filename = `compliance-report-${new Date().toISOString().slice(0, 10)}.csv`
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv)
  })
}

export default reportsRoutes
