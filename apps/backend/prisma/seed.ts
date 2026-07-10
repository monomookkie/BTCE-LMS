import { PrismaClient, Role } from '@prisma/client'
import { hashPassword } from '../src/lib/password.js'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  // --- Admin account ---
  const adminEmail = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@btec.rcthai.or.th'
  const adminPassword = process.env['SEED_ADMIN_PASSWORD']

  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD env var is required')
  }

  console.log(`  Creating admin: ${adminEmail}`)
  const hashedPassword = await hashPassword(adminPassword)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedPassword,
      name: 'ผู้ดูแลระบบ',
      role: Role.ADMIN,
      isActive: true,
      mustChangePassword: true, // บังคับเปลี่ยนรหัสหลังล็อกอินแรก
    },
  })

  // --- Sample course (optional, ไว้ทดสอบ flow) ---
  // ใช้ findFirst แทน upsert with hardcoded id เพื่อให้ Prisma auto-generate CUID ที่ถูกต้อง
  const existing = await prisma.course.findFirst({
    where: { titleEn: 'Workplace Safety (Sample)', deletedAt: null },
  })
  const sampleCourse = existing ?? await prisma.course.create({
    data: {
      titleEn: 'Workplace Safety (Sample)',
      titleTh: 'ความปลอดภัยในการทำงาน (ตัวอย่าง)',
      categoryEn: 'Safety',
      categoryTh: 'ความปลอดภัย',
      descriptionEn: 'A sample course for system testing',
      descriptionTh: 'หลักสูตรตัวอย่างสำหรับทดสอบระบบ',
      status: 'PUBLISHED',
      expiryMonths: 12,
      allowSelfEnroll: true,
    },
  })

  console.log(`  Sample course: ${sampleCourse.titleEn} (${sampleCourse.status}) id=${sampleCourse.id}`)

  // ทุก published course ต้องมี quiz อย่างน้อย 1 ข้อ (2A invariant) — เพิ่มให้ sample course
  const existingQuiz = await prisma.quiz.findFirst({
    where: { courseId: sampleCourse.id, deletedAt: null },
  })
  const sampleQuiz = existingQuiz ?? await prisma.quiz.create({
    data: {
      courseId: sampleCourse.id,
      titleEn: 'Workplace Safety Quiz (Sample)',
      titleTh: 'แบบทดสอบความปลอดภัยในการทำงาน (ตัวอย่าง)',
      passScore: 80,
      shuffle: true,
    },
  })
  const existingQuestion = await prisma.question.findFirst({
    where: { quizId: sampleQuiz.id, deletedAt: null },
  })
  if (!existingQuestion) {
    await prisma.question.create({
      data: {
        quizId: sampleQuiz.id,
        textEn: 'What should you do first when you notice a workplace hazard?',
        textTh: 'สิ่งแรกที่ควรทำเมื่อพบอันตรายในที่ทำงานคืออะไร?',
        order: 0,
        options: {
          create: [
            { textEn: 'Report it immediately', textTh: 'แจ้งทันที', isCorrect: true },
            { textEn: 'Ignore it and continue working', textTh: 'เพิกเฉยแล้วทำงานต่อ', isCorrect: false },
          ],
        },
      },
    })
  }

  console.log(`  Sample quiz: ${sampleQuiz.titleEn} id=${sampleQuiz.id}`)

  console.log('✅ Seed complete')
  console.log(`   Admin: ${adminEmail}`)
  console.log('   ⚠️  Please change admin password after first login')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
