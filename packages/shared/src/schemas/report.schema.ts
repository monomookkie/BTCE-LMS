import { z } from 'zod'

// ─── Dashboard Summary ────────────────────────────────────────────────────────

export const dashboardSummarySchema = z.object({
  totalUsers: z.number().int(),
  totalCourses: z.number().int(),           // PUBLISHED courses
  totalEnrollments: z.number().int(),
  completedEnrollments: z.number().int(),
  pendingEnrollments: z.number().int(),     // ASSIGNED + IN_PROGRESS
  // overall = mandatory + optional ปนกัน — ไม่ใช่ compliance rate ที่แท้จริง (2C-4)
  // ห้ามใช้ตัวนี้แทน mandatoryComplianceRate บน UI ที่ต้องการรายงาน compliance บังคับเรียน
  overallCompletionRate: z.number().nullable(), // completedEnrollments/totalEnrollments*100, null ถ้า totalEnrollments=0
  // 2C-4: แยกนับ mandatory (POSITION_BASED) vs optional (PUBLIC) — snapshot จาก Enrollment.isMandatory
  mandatoryEnrollments: z.number().int(),
  mandatoryCompleted: z.number().int(),
  // compliance rate ที่แท้จริง — นับเฉพาะ mandatory เท่านั้น (optional สมัครใจ ไม่เรียนก็ไม่ผิด)
  // null ถ้า mandatoryEnrollments=0 (ไม่มีอะไรให้วัด ต่างจาก "วัดแล้วได้ 0%")
  mandatoryComplianceRate: z.number().nullable(),
  optionalEnrollments: z.number().int(),
  optionalCompleted: z.number().int(),
})

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>

// ─── Compliance row ───────────────────────────────────────────────────────────
// PII ขั้นต่ำ — ชื่อ/หลักสูตรเท่านั้น ไม่มี email / employeeId

export const complianceRowSchema = z.object({
  enrollmentId: z.string(),
  userId: z.string(),
  userName: z.string(),
  courseId: z.string(),
  courseTitle: z.string(),                  // localized
  enrollmentStatus: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']),
  progress: z.number().int(),
  isMandatory: z.boolean(),                 // 2C-4: snapshot จาก Enrollment.isMandatory
  completedAt: z.string().nullable(),       // ISO8601
  // null = course นี้ไม่มี quiz (ไม่ใช่ "ยังไม่สอบ"); false = มี quiz แต่ยังไม่ผ่าน/ยังไม่สอบ — ความหมาย
  // เดียวกับ userReportRowSchema ด้านล่าง (คัดลอก semantics มา ไม่ใช่ backfill เดา)
  quizPassed: z.boolean().nullable(),
  quizCorrectCount: z.number().int().nullable(),
  quizTotalQuestions: z.number().int().nullable(),
})

export const complianceListSchema = z.object({
  data: z.array(complianceRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

export type ComplianceRow = z.infer<typeof complianceRowSchema>
export type ComplianceList = z.infer<typeof complianceListSchema>

// ─── By Course report (item 4) ─────────────────────────────────────────────

const ratingDistributionEntrySchema = z.object({
  rating: z.number().int().min(1).max(5),
  count: z.number().int(),
})

const ratingStatSchema = z.object({
  questionId: z.string().cuid(),
  text: z.string(),                         // localized question text
  average: z.number(),                      // 0 ถ้า responseCount=0
  responseCount: z.number().int(),
  distribution: z.array(ratingDistributionEntrySchema), // ครบ 5 entries เสมอ (rating 1-5) แม้ count=0
})

export const courseReportSchema = z.object({
  courseId: z.string().cuid(),
  courseTitle: z.string(),                  // localized
  enrollmentCount: z.number().int(),
  passCount: z.number().int(),              // distinct user ที่มี QuizAttempt.passed=true อย่างน้อย 1 ครั้ง
  passRate: z.number().nullable(),          // null ถ้า enrollmentCount=0
  hasSurvey: z.boolean(),                   // false → frontend ไม่แสดง satisfaction section
  ratingStats: z.array(ratingStatSchema),
})

export type RatingStat = z.infer<typeof ratingStatSchema>
export type CourseReport = z.infer<typeof courseReportSchema>

// รายชื่อคนที่สอบผ่าน — ไม่ใช่ context anonymous (ต่างจาก comments) เพราะเป็นสถานะสอบผ่าน/ตก
// ไม่ใช่ความเห็นส่วนตัว และ Compliance tab ก็โชว์ userName คู่กับ enrollment อยู่แล้วเป็นปกติ
export const coursePassedUserRowSchema = z.object({
  userId: z.string().cuid(),
  userName: z.string(),
  // ตอบถูกกี่ข้อ/เต็มกี่ข้อของ attempt ที่คะแนนสูงสุด — null ถ้า attempt นั้นเก่ากว่า migration
  // correctCount/totalQuestions (ไม่ backfill เดา) แสดง "—" แทนฝั่ง frontend
  correctCount: z.number().int().nullable(),
  totalQuestions: z.number().int().nullable(),
})

export const coursePassedUsersListSchema = z.object({
  data: z.array(coursePassedUserRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

export type CoursePassedUserRow = z.infer<typeof coursePassedUserRowSchema>
export type CoursePassedUsersList = z.infer<typeof coursePassedUsersListSchema>

// Anonymous by design (PDPA) — ห้ามมี userId/userName/createdAt แม้แต่ field เดียว
// (createdAt ตัดออกเพราะ timestamp ละเอียด + คอมเมนต์น้อย = เดาตัวตนได้จาก cross-reference กับ enrollment)
export const courseCommentRowSchema = z.object({
  questionId: z.string().cuid(),
  questionText: z.string(),                 // localized
  comment: z.string(),
})

export const courseCommentsListSchema = z.object({
  data: z.array(courseCommentRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
})

export type CourseCommentRow = z.infer<typeof courseCommentRowSchema>
export type CourseCommentsList = z.infer<typeof courseCommentsListSchema>

// ─── By User report (item 4) ───────────────────────────────────────────────
// ตรงข้ามกับ courseComments — report นี้ admin เลือก user ตรงๆ อยู่แล้ว จึงไม่ใช่บริบท anonymous

const userReportRowSchema = z.object({
  enrollmentId: z.string().cuid(),
  courseId: z.string().cuid(),
  courseTitle: z.string(),                  // localized
  status: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']),
  progress: z.number().int(),
  // null = course นี้ไม่มี quiz (ไม่ใช่ "ยังไม่สอบ"); false = มี quiz แต่ยังไม่ผ่าน/ยังไม่สอบ
  quizPassed: z.boolean().nullable(),
  // ตอบถูกกี่ข้อ/เต็มกี่ข้อของ attempt ที่คะแนนสูงสุด — null ถ้ายังไม่เคยสอบ/ไม่มี quiz/attempt
  // นั้นเก่ากว่า migration correctCount (ไม่ backfill เดา) แสดง "—" แทนฝั่ง frontend
  quizCorrectCount: z.number().int().nullable(),
  quizTotalQuestions: z.number().int().nullable(),
  completedAt: z.string().nullable(),
  dueAt: z.string().nullable(),
})

export const userReportSchema = z.object({
  userId: z.string().cuid(),
  userName: z.string(),
  mandatory: z.array(userReportRowSchema),
  optional: z.array(userReportRowSchema),
})

export type UserReportRow = z.infer<typeof userReportRowSchema>
export type UserReport = z.infer<typeof userReportSchema>
