import { PrismaClient, Role } from '@prisma/client'
import { hashPassword } from '../src/lib/password.js'

const prisma = new PrismaClient()

// departments จริงของศูนย์บริการโลหิตแห่งชาติ สภากาชาดไทย
const DEPARTMENTS = [
  'ฝ่ายบริหาร',
  'ฝ่ายการแพทย์',
  'ฝ่ายธนาคารเลือด',
  'ฝ่ายเทคโนโลยีสารสนเทศ',
  'ฝ่ายประชาสัมพันธ์',
  'ฝ่ายวิจัยและพัฒนา',
  'ฝ่ายจัดการคุณภาพ',
  'ฝ่ายรับบริจาคโลหิต',
  'ฝ่ายบัญชีและการเงิน',
  'ฝ่ายทรัพยากรบุคคล',
  'ฝ่ายอาคารสถานที่',
  'ฝ่ายโลหิตวิทยา',
]

async function main() {
  console.log('🌱 Starting seed...')

  // --- Departments ---
  console.log('  Creating departments...')
  await Promise.all(
    DEPARTMENTS.map((name) =>
      prisma.department.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    ),
  )

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
  const sampleCourse = await prisma.course.upsert({
    where: { id: 'seed-course-001' },
    update: {},
    create: {
      id: 'seed-course-001',
      title: 'ความปลอดภัยในการทำงาน (ตัวอย่าง)',
      category: 'ความปลอดภัย',
      description: 'หลักสูตรตัวอย่างสำหรับทดสอบระบบ',
      status: 'DRAFT',
      passScore: 80,
      expiryMonths: 12,
    },
  })

  console.log(`  Sample course: ${sampleCourse.title} (DRAFT)`)

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
