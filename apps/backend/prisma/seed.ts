import { PrismaClient, Role } from '@prisma/client'
import { hashPassword } from '../src/lib/password.js'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  // --- Positions ---
  // ตำแหน่งงานจริงของศูนย์ฯ — ยืนยันแล้วว่ามีแค่ 5 อันนี้เท่านั้น ห้ามเพิ่มเอง
  // "Administrator" เป็นข้อยกเว้น (ไม่ใช่ตำแหน่งงานจริง) เก็บไว้สำหรับ system admin โดยเฉพาะ
  // "Others" ไม่ใช่ row จริงในตาราง — เป็น sentinel ฝั่ง UI เท่านั้น (RegisterPage ส่ง positionId: null)
  const POSITIONS: { nameEn: string; nameTh: string; isSystemOnly?: boolean }[] = [
    { nameEn: 'Medical Technologist', nameTh: 'นักเทคนิคการแพทย์' },
    { nameEn: 'Medical Scientist', nameTh: 'นักวิทยาศาสตร์การแพทย์' },
    { nameEn: 'Medical Technician Assistant', nameTh: 'ผู้ช่วยนักเทคนิคการแพทย์' },
    { nameEn: 'General Administration Officer', nameTh: 'เจ้าหน้าที่บริหารงานทั่วไป' },
    // isSystemOnly: ไม่ขึ้นให้เลือกในหน้า self-register (GET /positions filter ออก) — ADMIN
    // ยัง assign ให้ user อื่นได้ปกติผ่าน /positions/admin
    { nameEn: 'Administrator', nameTh: 'ผู้ดูแลระบบ', isSystemOnly: true },
  ]

  console.log('  Seeding positions...')
  const positionIdByNameEn = new Map<string, string>()
  for (const p of POSITIONS) {
    // findFirst+update/create แทน upsert-by-nameEn — nameEn มี unique constraint จริง แต่ upsert
    // ทับ isSystemOnly ทุกครั้งที่ reseed ไม่ได้ถ้า admin แก้ผ่าน Manage Positions ไปแล้วในอนาคต
    // (ตอนนี้ยังไม่มี UI แก้ isSystemOnly ก็เลยไม่ต่างกันในทางปฏิบัติ แต่เขียนแบบ explicit ไว้ก่อน)
    const existingPosition = await prisma.position.findFirst({ where: { nameEn: p.nameEn } })
    const position = existingPosition
      ? await prisma.position.update({
          where: { id: existingPosition.id },
          data: { nameTh: p.nameTh, deletedAt: null, isSystemOnly: p.isSystemOnly ?? false },
        })
      : await prisma.position.create({
          data: { nameEn: p.nameEn, nameTh: p.nameTh, isSystemOnly: p.isSystemOnly ?? false },
        })
    positionIdByNameEn.set(p.nameEn, position.id)
  }

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
    update: {}, // ตั้งใจไม่แก้ทับ record ที่มีอยู่แล้ว (เช่น positionId ที่ admin อาจเปลี่ยนเองภายหลัง)
    create: {
      email: adminEmail,
      password: hashedPassword,
      name: 'ผู้ดูแลระบบ',
      role: Role.ADMIN,
      isActive: true,
      mustChangePassword: true, // บังคับเปลี่ยนรหัสหลังล็อกอินแรก
      positionId: positionIdByNameEn.get('Administrator'),
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
      accessType: 'PUBLIC',
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
      passRequiredCount: 1, // quiz นี้มี 1 คำถาม — ต้องตอบถูกทั้งหมดถึงผ่าน
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
