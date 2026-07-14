import type { FastifyPluginAsync } from 'fastify'
import { type ZodTypeProvider } from 'fastify-type-provider-zod'
import {
  dashboardSummarySchema,
  complianceListSchema,
  courseReportSchema,
  courseCommentsListSchema,
  userReportSchema,
  coursePassedUsersListSchema,
} from '@btec-lms/shared'
import {
  complianceQuerySchema,
  complianceExportQuerySchema,
  courseReportQuerySchema,
  courseCommentsQuerySchema,
  userReportQuerySchema,
  coursePassedUsersQuerySchema,
} from './reports.schema.js'
import {
  getDashboardSummary,
  getComplianceList,
  getComplianceCsv,
  getCourseReport,
  getCourseComments,
  getUserReport,
  getCoursePassedUsers,
} from './reports.service.js'
import { resolveLocale } from '../../lib/i18n.js'

const reportsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ─── GET /reports/dashboard — ADMIN ────────────────────────────────
  server.get('/reports/dashboard', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      response: { 200: dashboardSummarySchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getDashboardSummary(app.prisma, req.user.id, req.user.role, locale)
  })

  // ─── GET /reports/compliance — ADMIN (paginated) ──────────────────
  // ADMIN: สามารถ filter ด้วย courseId
  server.get('/reports/compliance', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      querystring: complianceQuerySchema,
      response: { 200: complianceListSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getComplianceList(app.prisma, req.user.id, req.user.role, req.query, locale, req.ip)
  })

  // ─── GET /reports/compliance/export — CSV download ───────────────────────────
  // Rate limit เข้มกว่า global: 5 req/min (ดึง PII ก้อนใหญ่)
  // Audit log: REPORT_EXPORT บันทึก scope + row count ทุกครั้ง
  server.get('/reports/compliance/export', {
    preHandler: [app.requireRole(['ADMIN'])],
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

  // ─── GET /reports/by-course — ADMIN (enrollment/pass count + survey rating stats) ──
  server.get('/reports/by-course', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      querystring: courseReportQuerySchema,
      response: { 200: courseReportSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getCourseReport(app.prisma, req.query.courseId, req.user.id, locale, req.ip)
  })

  // ─── GET /reports/by-course/comments — ADMIN (anonymous free-text, paginated) ──────
  // PDPA: response ไม่มี userId/userName/createdAt เลย (ดู reports.service.ts getCourseComments)
  server.get('/reports/by-course/comments', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      querystring: courseCommentsQuerySchema,
      response: { 200: courseCommentsListSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getCourseComments(app.prisma, req.query, req.user.id, locale, req.ip)
  })

  // ─── GET /reports/by-course/passed — ADMIN (named list, not anonymous — see service comment) ──
  server.get('/reports/by-course/passed', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      querystring: coursePassedUsersQuerySchema,
      response: { 200: coursePassedUsersListSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getCoursePassedUsers(app.prisma, req.query, req.user.id, locale, req.ip)
  })

  // ─── GET /reports/by-user — ADMIN (enrollment list, mandatory/optional split) ──────
  server.get('/reports/by-user', {
    preHandler: [app.requireRole(['ADMIN'])],
    schema: {
      querystring: userReportQuerySchema,
      response: { 200: userReportSchema },
    },
  }, async (req) => {
    const locale = await resolveLocale(req, app.prisma)
    return getUserReport(app.prisma, req.query.userId, req.user.id, locale, req.ip)
  })
}

export default reportsRoutes
