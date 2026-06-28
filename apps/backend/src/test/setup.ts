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
    prisma.trainingAttendee.deleteMany(),
    prisma.certificate.deleteMany(),  // FK → enrollment, user
    prisma.enrollment.deleteMany(),   // FK → user, course
    prisma.refreshToken.deleteMany(), // FK → user
    prisma.user.deleteMany(),         // FK → department
    prisma.department.deleteMany(),
    prisma.option.deleteMany(),       // FK → question
    prisma.question.deleteMany(),     // FK → quiz
    prisma.quiz.deleteMany(),         // FK → course
    prisma.material.deleteMany(),     // FK → course
    prisma.course.deleteMany(),
    prisma.trainingLog.deleteMany(),
    prisma.announcement.deleteMany(),
  ])
})
