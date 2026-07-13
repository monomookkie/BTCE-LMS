import { beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'

// ใช้ PrismaClient ตรง (ไม่ใช่ singleton) เพื่อให้ cleanup ทำงานอิสระ
// DATABASE_URL ถูก inject จาก vitest.config.ts ก่อน module นี้ถูก import
const prisma = new PrismaClient()

beforeEach(async () => {
  // $transaction ใช้ connection เดียว ทำให้ delete เรียงตาม FK order ได้อย่างถูกต้อง
  // ลำดับ: ลบ child ก่อน parent เสมอ
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.consent.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.quizAttempt.deleteMany(),
    prisma.surveyResponse.deleteMany(), // FK → survey
    prisma.surveyQuestion.deleteMany(), // FK → survey
    prisma.trainingAttendee.deleteMany(),
    prisma.externalCertificate.deleteMany(), // FK → user (ON DELETE RESTRICT)
    prisma.materialProgress.deleteMany(),    // FK → enrollment
    prisma.enrollment.deleteMany(),          // FK → user, course
    prisma.refreshToken.deleteMany(), // FK → user
    prisma.user.deleteMany(),
    prisma.coursePosition.deleteMany(), // FK → course, position (ON DELETE RESTRICT ทั้งคู่ — ต้องลบก่อน)
    prisma.position.deleteMany(),     // FK จาก User เป็น ON DELETE SET NULL — ลบทีหลังได้เสมอ
    prisma.option.deleteMany(),       // FK → question
    prisma.question.deleteMany(),     // FK → quiz
    prisma.quiz.deleteMany(),         // FK → course
    prisma.survey.deleteMany(),       // FK → course
    prisma.material.deleteMany(),     // FK → course
    prisma.course.deleteMany(),
    prisma.trainingLog.deleteMany(),
    prisma.announcement.deleteMany(),
  ])
})
