# แผนพัฒนา BTEC LMS v2 (Production)
### Blood Testing Education Center — Learning Management System
**ศูนย์บริการโลหิตแห่งชาติ สภากาชาดไทย**

> เอกสารวางแผนพัฒนาระบบใหม่ทั้งหมด (rebuild) สำหรับการใช้งานจริงระดับ production
> Stack หลัก: **TypeScript เต็มตัว** ทั้ง frontend และ backend
> สถานะ: ฉบับร่างเพื่อวางแผน — ปรับแก้ได้ตามการตัดสินใจของทีม

---

## สารบัญ

1. [ภาพรวมและเป้าหมาย](#1-ภาพรวมและเป้าหมาย)
2. [จุดอ่อนของระบบเดิมที่ต้องแก้](#2-จุดอ่อนของระบบเดิมที่ต้องแก้)
3. [สถาปัตยกรรมและ Tech Stack](#3-สถาปัตยกรรมและ-tech-stack)
4. [โครงสร้างโปรเจกต์](#4-โครงสร้างโปรเจกต์)
5. [Database Schema ใหม่](#5-database-schema-ใหม่)
6. [Security และ PDPA Compliance](#6-security-และ-pdpa-compliance)
7. [Roadmap แบ่งเป็นเฟส](#7-roadmap-แบ่งเป็นเฟส)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [DevOps / CI-CD](#9-devops--ci-cd)
10. [Testing Strategy](#10-testing-strategy)
11. [เริ่มจากศูนย์ (ไม่ดึงข้อมูลเดิม)](#11-เริ่มจากศูนย์-fresh-start--ไม่ดึงข้อมูลเดิม)
12. [Go-Live Checklist](#12-go-live-checklist)

---

## 1. ภาพรวมและเป้าหมาย

### ระบบทำอะไร
ระบบจัดการการเรียนรู้และการอบรม (LMS) สำหรับเจ้าหน้าที่ศูนย์บริการโลหิตฯ ครอบคลุม:
- จัดการหลักสูตร + สื่อการเรียน + แบบทดสอบ
- ลงทะเบียนเรียน ติดตามความคืบหน้า สอบ Post-Test
- ออกใบรับรอง (Certificate) อัตโนมัติเมื่อผ่านเกณฑ์
- บันทึกการอบรมแบบ offline (Training Log)
- รายงาน compliance + analytics

### เป้าหมายของการ rebuild
| เป้าหมาย | ตัวชี้วัดความสำเร็จ |
|----------|---------------------|
| ความปลอดภัยระดับ production | ผ่าน security checklist, auth ใช้ httpOnly cookie |
| รองรับ PDPA | มี consent, audit log, สิทธิ์ลบ/แก้ไขข้อมูลส่วนบุคคล |
| ลด bug ตอนระบบโต | TypeScript ครอบคลุม + test สำคัญ ๆ |
| ไฟล์ไม่ทำ DB บวม | ย้ายไฟล์ทั้งหมดไป object storage |
| รองรับการต่ออายุใบรับรอง | มี cert expiry + ระบบแจ้งเตือน |
| Maintainable | โครงสร้างชัด มีเอกสาร onboarding ได้เร็ว |

### สิ่งที่เพิ่มใหม่ (ระบบเดิมไม่มี)
- ใบรับรองมี **วันหมดอายุ + แจ้งเตือนต่ออายุ** (สำคัญมากสำหรับงานแล็บ/การแพทย์)
- **Audit log** บันทึกทุกการกระทำสำคัญ (ใครทำอะไรเมื่อไหร่)
- **PDPA**: consent log, สิทธิ์เจ้าของข้อมูล
- **Quiz engine** ที่จัดการข้อสอบเป็นตารางจริง (สุ่มข้อ จำกัดจำนวนครั้งสอบ วิเคราะห์ผลได้)
- **Email notification** (มอบหมายหลักสูตร / ใกล้หมดอายุ)
- **Bulk import** ผู้ใช้จาก CSV
- **Public certificate verification** (ตรวจสอบใบรับรองด้วยเลขที่/QR)

---

## 2. จุดอ่อนของระบบเดิมที่ต้องแก้

| # | ปัญหาเดิม | ผลกระทบ | วิธีแก้ใหม่ |
|---|-----------|---------|-------------|
| 1 | JWT เก็บใน `sessionStorage` | เสี่ยง XSS ขโมย token | httpOnly + Secure cookie + refresh token rotation |
| 2 | ไฟล์เก็บเป็น base64 (`dataUrl`, `fileData`, `doc`) | DB บวม, query ช้า, backup ยาก | ออกแบบใหม่ให้เก็บไฟล์ใน object storage ตั้งแต่ต้น เก็บแค่ key |
| 3 | JS ล้วน | bug ตอน refactor เยอะ | TypeScript + Zod validation |
| 4 | `questions` เก็บเป็น JSON ก้อนเดียว | สุ่มข้อ/จำกัดครั้งสอบ/วิเคราะห์ไม่ได้ | แยกตาราง Quiz/Question/Option/Attempt |
| 5 | fetch wrapper เขียนเอง | ไม่มี cache/retry/loading ที่ดี | TanStack Query |
| 6 | ไม่มี audit log | ตรวจสอบย้อนหลังไม่ได้ (ผิดหลัก compliance) | ตาราง AuditLog |
| 7 | ไม่มี cert expiry | ใบรับรองหมดอายุแล้วไม่รู้ | `expiresAt` + cron แจ้งเตือน |
| 8 | ไม่มี soft delete | ลบผิดกู้ไม่ได้ | `deletedAt` ทุกตารางสำคัญ |
| 9 | ไม่มี input validation ชัดเจน | ข้อมูลเสียเข้า DB ได้ | Zod schema share ทั้ง 2 ฝั่ง |
| 10 | ไม่มี test / CI | regression ง่าย | Vitest + Playwright + GitHub Actions |

---

## 3. สถาปัตยกรรมและ Tech Stack

### แนวทางสถาปัตยกรรม
```
┌─────────────┐    HTTPS     ┌──────────────┐   Prisma   ┌──────────┐
│  Frontend   │ ───────────► │   Backend    │ ─────────► │ MariaDB  │
│ React + TS  │  cookie auth │ Fastify + TS │            │ (MySQL)  │
│  (Vercel)   │ ◄─────────── │  (Railway)   │            └──────────┘
└─────────────┘   JSON API   └──────┬───────┘
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                  ┌──────────────┐    ┌──────────────┐
                  │ Object Store │    │  Email (SMTP │
                  │  (R2/S3)     │    │   / Resend)  │
                  └──────────────┘    └──────────────┘
```

### Tech Stack

| ส่วน | เทคโนโลยี | เหตุผล |
|------|-----------|--------|
| ภาษา | **TypeScript** ทั้ง stack | type safety, refactor ปลอดภัย |
| Frontend | React 18 + Vite | คงของเดิม คุ้นมือ |
| State (server) | TanStack Query | cache/retry/loading ดีกว่า fetch เอง |
| Form | React Hook Form + Zod | validation + UX form ดี |
| UI | Tailwind CSS + (shadcn/ui ถ้าต้องการ) | คงของเดิม เร็ว |
| Routing | React Router v6 | มาตรฐาน |
| Backend | **Fastify + TypeScript** | เร็วกว่า Express, มี schema validation + pino มาในตัว |
| Validation | Zod + `fastify-type-provider-zod` | ใช้ Zod เป็น route schema ได้เลย share กับ FE |
| DB | MariaDB/MySQL | คงของเดิม |
| ORM | Prisma | type-safe, migration ดี |
| Auth | `@fastify/jwt` + `@fastify/cookie` (httpOnly) + refresh token | ปลอดภัยกว่า sessionStorage |
| File storage | Cloudflare R2 หรือ Cloudinary (`@fastify/multipart`) | ไม่บวม DB |
| Email | Resend หรือ SMTP (nodemailer) | แจ้งเตือน |
| PDF cert | `@react-pdf/renderer` หรือ Puppeteer | gen on-demand |
| Job/Cron | node-cron หรือ Railway cron | เช็ค cert ใกล้หมดอายุ |
| Logging | **pino (built-in ของ Fastify)** | structured log ได้ฟรี |
| Testing | Vitest + `app.inject()` + Playwright | unit/integration/e2e |
| Deploy | Vercel (FE) + Railway (BE) | คงของเดิม |
| CI/CD | GitHub Actions | คุณทำเป็นอยู่แล้ว |

> **หมายเหตุเรื่อง monorepo**: แนะนำใช้ monorepo (pnpm workspace + Turborepo) เพื่อ share Zod schema/type ระหว่าง FE-BE ใน package `shared/` ถ้ายังไม่ถนัด เริ่มเป็น 2 repo ก่อนแล้วค่อยรวมก็ได้

---

## 4. โครงสร้างโปรเจกต์

แบบ monorepo (แนะนำ):

```
btec-lms/
├── package.json                 # pnpm workspace root
├── turbo.json
├── docker-compose.yml           # MariaDB + adminer สำหรับ dev
├── packages/
│   └── shared/                  # Zod schema + type ที่ FE-BE ใช้ร่วมกัน
│       └── src/
│           ├── schemas/         # userSchema, courseSchema, quizSchema...
│           └── types/
├── apps/
│   ├── frontend/
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── lib/
│   │       │   ├── api.ts            # axios/fetch + interceptor cookie
│   │       │   └── queryClient.ts    # TanStack Query config
│   │       ├── hooks/
│   │       │   ├── useAuth.ts
│   │       │   └── useToast.ts
│   │       ├── components/
│   │       │   └── ui/
│   │       └── pages/
│   │           ├── auth/
│   │           ├── admin/
│   │           └── user/
│   └── backend/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       └── src/
│           ├── server.ts             # สร้าง Fastify instance + ลงทะเบียน plugin
│           ├── app.ts                # buildApp() แยกไว้เพื่อ test ด้วย inject()
│           ├── config/env.ts         # validate env ด้วย Zod
│           ├── lib/
│           │   ├── prisma.ts
│           │   ├── storage.ts        # อัปโหลด/ลบไฟล์ object storage
│           │   ├── mailer.ts
│           │   └── pdf.ts            # gen certificate PDF
│           ├── plugins/              # Fastify plugins (fastify-plugin)
│           │   ├── auth.ts           # @fastify/jwt + @fastify/cookie + decorate authenticate
│           │   ├── rbac.ts           # decorator requireRole
│           │   ├── rateLimit.ts      # @fastify/rate-limit
│           │   ├── security.ts       # @fastify/helmet + @fastify/cors
│           │   └── prisma.ts         # decorate app.prisma
│           ├── hooks/
│           │   └── audit.ts          # onResponse hook บันทึก audit log
│           ├── modules/              # แยกตาม domain
│           │   ├── auth/
│           │   ├── users/
│           │   ├── courses/
│           │   ├── enrollments/
│           │   ├── quizzes/
│           │   ├── certificates/
│           │   ├── trainingLogs/
│           │   ├── announcements/
│           │   └── reports/
│           └── jobs/
│               └── certExpiryReminder.ts
└── .github/workflows/
    ├── ci.yml
    └── deploy.yml
```

> แต่ละ module แยกเป็น `*.routes.ts` (ลงทะเบียนเป็น Fastify plugin + ผูก Zod schema กับ route), `*.service.ts`, `*.schema.ts` — แยก business logic ออกจาก route ทำให้ test ง่ายและไม่ปนกัน ฝั่ง route ใช้ `fastify-type-provider-zod` เพื่อให้ validate + infer type จาก Zod schema เดียวกับ FE

---

## 5. Database Schema ใหม่

ปรับจากเดิม โดยเน้น: แยกตารางที่ควรแยก, soft delete, timestamp, cert expiry, audit, quiz engine จริง

```prisma
// ===== Auth & User =====
model User {
  id              String    @id @default(cuid())
  employeeId      String?   @unique          // รหัสพนักงาน
  name            String
  email           String    @unique
  password        String
  role            Role      @default(USER)
  departmentId    String?
  position        String?
  avatarKey       String?                     // key ใน object storage (ไม่ใช่ base64)
  isActive        Boolean   @default(true)
  lastLoginAt     DateTime?
  passwordChangedAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?                   // soft delete

  department      Department?   @relation(fields: [departmentId], references: [id])
  enrollments     Enrollment[]
  certificates    Certificate[]
  refreshTokens   RefreshToken[]
  consents        Consent[]
}

enum Role { ADMIN MANAGER USER }   // เพิ่ม MANAGER สำหรับหัวหน้าแผนกดู report ของลูกทีม

model Department {
  id     String @id @default(cuid())
  name   String @unique
  users  User[]
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String                          // เก็บ hash ไม่เก็บ token ตรง ๆ
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}

// ===== Course & Material =====
model Course {
  id           String     @id @default(cuid())
  title        String
  category     String
  description  String?    @db.Text
  status       CourseStatus @default(DRAFT)
  durationMin  Int?
  passScore    Int        @default(80)
  expiryMonths Int?                          // ใหม่: ต้องต่ออายุทุกกี่เดือน (null = ไม่หมดอายุ)
  createdById  String?
  version      Int        @default(1)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  deletedAt    DateTime?

  materials    Material[]
  quiz         Quiz?
  enrollments  Enrollment[]
}

enum CourseStatus { DRAFT PUBLISHED ARCHIVED }

model Material {
  id        String   @id @default(cuid())
  courseId  String
  type      MaterialType
  title     String
  fileKey   String?                          // ย้ายจาก dataUrl → object storage key
  url       String?                          // กรณีเป็น external link/video
  mimeType  String?
  sizeBytes Int?
  order     Int      @default(0)             // ใหม่: เรียงลำดับสื่อ
  createdAt DateTime @default(now())
  course    Course   @relation(fields: [courseId], references: [id])
}

enum MaterialType { PDF VIDEO LINK IMAGE DOC }

// ===== Quiz Engine (แยกตารางจริง) =====
model Quiz {
  id           String   @id @default(cuid())
  courseId     String   @unique
  title        String
  maxAttempts  Int?                          // จำกัดจำนวนครั้งสอบ
  shuffle      Boolean  @default(true)       // สุ่มลำดับข้อ
  course       Course   @relation(fields: [courseId], references: [id])
  questions    Question[]
  attempts     QuizAttempt[]
}

model Question {
  id       String   @id @default(cuid())
  quizId   String
  text     String   @db.Text
  order    Int      @default(0)
  quiz     Quiz     @relation(fields: [quizId], references: [id])
  options  Option[]
}

model Option {
  id         String   @id @default(cuid())
  questionId String
  text       String
  isCorrect  Boolean  @default(false)
  question   Question @relation(fields: [questionId], references: [id])
}

model QuizAttempt {
  id           String   @id @default(cuid())
  quizId       String
  userId       String
  score        Int
  passed       Boolean
  answers      Json                          // เก็บคำตอบที่เลือกไว้ทบทวน
  createdAt    DateTime @default(now())
  quiz         Quiz     @relation(fields: [quizId], references: [id])
}

// ===== Enrollment & Certificate =====
model Enrollment {
  id                 String    @id @default(cuid())
  userId             String
  courseId           String
  status             EnrollStatus @default(IN_PROGRESS)
  progress           Int       @default(0)
  completedMaterials Json      @default("[]")
  assignedAt         DateTime  @default(now())
  dueAt              DateTime?                // กำหนดส่ง
  completedAt        DateTime?
  createdAt          DateTime  @default(now())

  user        User     @relation(fields: [userId], references: [id])
  course      Course   @relation(fields: [courseId], references: [id])
  certificate Certificate?

  @@unique([userId, courseId])
}

enum EnrollStatus { ASSIGNED IN_PROGRESS COMPLETED EXPIRED }

model Certificate {
  id           String    @id @default(cuid())
  enrollmentId String    @unique
  userId       String
  courseId     String
  certNumber   String    @unique             // BTEC-YYYY-MMDD-XXXX
  score        Int
  fileKey      String?                        // PDF ที่ gen แล้ว เก็บใน storage
  verifyHash   String    @unique             // ใช้ตรวจสอบ public
  issuedAt     DateTime  @default(now())
  expiresAt    DateTime?                       // ใหม่: คำนวณจาก course.expiryMonths
  revokedAt    DateTime?

  user         User      @relation(fields: [userId], references: [id])
  enrollment   Enrollment @relation(fields: [enrollmentId], references: [id])
}

// ===== Training Log (offline) =====
model TrainingLog {
  id        String   @id @default(cuid())
  title     String
  date      DateTime
  trainer   String
  location  String?
  durationMin Int?
  type      String?
  topics    String?  @db.Text
  fileKey   String?                           // ย้ายจาก doc → storage
  createdAt DateTime @default(now())
  attendees TrainingAttendee[]
}

model TrainingAttendee {
  trainingId String
  userId     String
  training   TrainingLog @relation(fields: [trainingId], references: [id])
  @@id([trainingId, userId])
}

// ===== Announcement =====
model Announcement {
  id        String   @id @default(cuid())
  title     String
  content   String   @db.Text
  type      String   @default("INFO")
  fileKey   String?                           // ย้ายจาก fileData → storage
  link      String?
  createdAt DateTime @default(now())
  deletedAt DateTime?
}

// ===== Compliance =====
model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?                          // ใครทำ
  action     String                           // เช่น "USER_DELETE", "CERT_ISSUE"
  targetType String?                          // "User", "Course"...
  targetId   String?
  metadata   Json?
  ip         String?
  createdAt  DateTime @default(now())

  @@index([actorId])
  @@index([targetType, targetId])
}

model Consent {
  id          String   @id @default(cuid())
  userId      String
  type        String                          // "PDPA_BASIC", "MARKETING"...
  granted     Boolean
  version     String                          // เวอร์ชันของ privacy policy
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  title     String
  body      String?
  link      String?
  readAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId, readAt])
}
```

---

## 6. Security และ PDPA Compliance

### Authentication & Authorization
- **httpOnly + Secure + SameSite cookie** เก็บ access token (อายุสั้น ~15 นาที) ผ่าน `@fastify/cookie` + `@fastify/jwt`
- **Refresh token rotation**: เก็บ hash ใน DB, ออก token ใหม่ทุกครั้ง revoke ตัวเก่า
- **RBAC** 3 ระดับ: ADMIN / MANAGER / USER ตรวจผ่าน decorator `requireRole` (preHandler hook)
- **Password**: hash ด้วย argon2 (หรือ bcrypt rounds ≥ 12)
- **Rate limiting** ด้วย `@fastify/rate-limit` ที่ `/login`, `/register`, `/forgot-password` กัน brute force
- **CSRF protection** (เพราะใช้ cookie) — `@fastify/csrf-protection` หรือ SameSite=Strict

### PDPA (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล)
เนื่องจากเก็บข้อมูลส่วนบุคคลของเจ้าหน้าที่:
- **Consent log** — บันทึกการยินยอม + เวอร์ชัน privacy policy
- **สิทธิ์เจ้าของข้อมูล** — ขอดู / แก้ไข / ลบข้อมูลตัวเอง (right to access/rectify/erasure)
- **Data minimization** — เก็บเท่าที่จำเป็น
- **Audit log** — ใครเข้าถึง/แก้ไขข้อมูลส่วนบุคคลบ้าง
- **เข้ารหัสระหว่างส่ง** — HTTPS บังคับ
- **Retention policy** — กำหนดระยะเวลาเก็บข้อมูล

### ทั่วไป
- Validate input ทุก endpoint ด้วย Zod ผูกเป็น route schema (`fastify-type-provider-zod`) — Fastify reject อัตโนมัติถ้าไม่ผ่าน
- ไฟล์อัปโหลด: `@fastify/multipart` จำกัดชนิด/ขนาด, scan ชื่อไฟล์, เสิร์ฟผ่าน signed URL
- env secrets ไม่ commit ลง repo, validate ด้วย Zod ตอน boot
- Security headers ด้วย `@fastify/helmet`
- ตั้ง CORS ด้วย `@fastify/cors` ให้รับเฉพาะ origin ของ frontend

---

## 7. Roadmap แบ่งเป็นเฟส

> ประเมินเวลาแบบทำคนเดียว part-time ปรับตามจริงได้

### Phase 0 — รากฐาน (1–2 สัปดาห์)
- [ ] ตั้ง monorepo (pnpm + Turborepo) + TypeScript config
- [ ] ESLint + Prettier + Husky (pre-commit)
- [ ] docker-compose: MariaDB + adminer สำหรับ dev
- [ ] Prisma schema ใหม่ทั้งหมด + migration แรก + seed
- [ ] package `shared/` ใส่ Zod schema กลาง
- [ ] ตั้ง env validation + lib พื้นฐาน (prisma, logger)
- [ ] สร้าง Fastify app skeleton: `buildApp()` + ลงทะเบียน plugin หลัก (cookie, jwt, helmet, cors, rate-limit, multipart, type-provider-zod)

### Phase 1 — Auth & User (1–2 สัปดาห์)
- [ ] Register / Login ด้วย httpOnly cookie + refresh rotation
- [ ] Auth plugin (verify cookie) + requireRole decorator + rate limit
- [ ] Profile + เปลี่ยนรหัสผ่าน
- [ ] CRUD user (admin) + soft delete
- [ ] Bulk import user จาก CSV
- [ ] Consent + audit log hook (onResponse)

### Phase 2 — Course & Material (1–2 สัปดาห์)
- [ ] CRUD course + draft/publish/archive
- [ ] อัปโหลดไฟล์ไป object storage (signed URL)
- [ ] Material หลายชนิด + reorder
- [ ] ตั้งค่า expiryMonths ต่อหลักสูตร

### Phase 3 — Enrollment & Quiz (2 สัปดาห์)
- [ ] ลงทะเบียน / มอบหมาย (assign) + due date
- [ ] ติดตาม progress รายสื่อ
- [ ] Quiz engine: question/option/attempt, สุ่มข้อ, จำกัดครั้งสอบ
- [ ] Auto-grade + บันทึก attempt

### Phase 4 — Certificate & Compliance (1–2 สัปดาห์)
- [ ] ออก cert อัตโนมัติเมื่อผ่านเกณฑ์
- [ ] Gen PDF on-demand (เก็บใน storage)
- [ ] cert expiry + cron แจ้งเตือนใกล้หมดอายุ (email + in-app)
- [ ] External cert
- [ ] Public verification ด้วย certNumber/QR

### Phase 5 — Reporting & Polish (1–2 สัปดาห์)
- [ ] Dashboard analytics (admin/manager)
- [ ] Compliance report (ใครต้องอบรม/ใกล้หมดอายุ)
- [ ] Announcement + notification center
- [ ] Email integration
- [ ] Accessibility (a11y) + responsive
- [ ] เขียน test ส่วนสำคัญ + CI/CD เต็มรูปแบบ

---

## 8. Non-Functional Requirements

| ด้าน | เป้าหมาย |
|------|----------|
| Performance | API ตอบ < 300ms (p95), หน้าโหลด < 2s |
| Availability | uptime ≥ 99.5% |
| Backup | DB backup อัตโนมัติทุกวัน + เก็บย้อนหลัง ≥ 7 วัน |
| Monitoring | health check endpoint + error tracking (Sentry) + log |
| Scalability | stateless backend (scale แนวนอนได้), ไฟล์อยู่ object storage |
| Accessibility | รองรับ keyboard nav, contrast ผ่าน WCAG AA |
| i18n | รองรับภาษาไทยเป็นหลัก (เผื่อ EN ภายหลัง) |
| Browser | รองรับ Chrome/Edge/Firefox/Safari เวอร์ชันล่าสุด |

---

## 9. DevOps / CI-CD

### Environments
- **dev** (local + docker), **staging** (ทดสอบก่อนขึ้นจริง), **production**
- env แยกชัด ไม่ปนกัน

### GitHub Actions
**ci.yml** (ทุก PR):
- install + typecheck (`tsc --noEmit`)
- lint
- test (Vitest)
- build

**deploy.yml** (merge เข้า main):
- run migration (`prisma migrate deploy`)
- deploy backend → Railway
- deploy frontend → Vercel
- smoke test

> ตั้ง branch protection: ต้องผ่าน CI + review ก่อน merge เข้า main

---

## 10. Testing Strategy

| ระดับ | เครื่องมือ | ครอบคลุม |
|-------|-----------|----------|
| Unit | Vitest | service logic, quiz grading, cert number gen |
| Integration | Vitest + `app.inject()` | API endpoints + DB (test container) — ไม่ต้องเปิด port จริง |
| E2E | Playwright | flow สำคัญ: login → เรียน → สอบ → ได้ cert |
| Type | `tsc --noEmit` | type ทั้งโปรเจกต์ |

โฟกัส test ที่ logic เสี่ยงพังและกระทบ compliance: การออก cert, การคิดคะแนน, สิทธิ์ตาม role, cert expiry

---

## 11. เริ่มจากศูนย์ (Fresh Start — ไม่ดึงข้อมูลเดิม)

> ตัดสินใจแล้วว่า**ไม่ย้ายข้อมูลจาก DB เดิม** เริ่มฐานข้อมูลใหม่ทั้งหมด ทำให้ตัดงาน migration ที่ซับซ้อนและเสี่ยงสุดออกไปได้ทั้งหมด (ไม่ต้อง decode ไฟล์ base64 เดิม ไม่ต้อง map schema เก่า ไม่ต้อง cutover แบบมี downtime)

สิ่งที่ต้องเตรียมแทนคือ **seed ข้อมูลตั้งต้น** ให้ระบบพร้อมใช้ตั้งแต่วันแรก:

1. **บัญชี admin เริ่มต้น** — สร้าง 1 บัญชีผ่าน `seed.ts` (อ่านรหัสจาก env ไม่ hardcode) ไว้ล็อกอินครั้งแรก แล้วบังคับเปลี่ยนรหัสทันที
2. **Department ตั้งต้น** — ใส่รายชื่อแผนกจริงของศูนย์ฯ
3. **หลักสูตรตัวอย่าง** (optional) — ไว้ทดสอบ flow ก่อน admin สร้างของจริง
4. **CertTemplate ค่าเริ่มต้น** — ชื่อองค์กร โลโก้ สีหลัก สำหรับใบรับรอง

จากนั้นข้อมูลจริงทั้งหมด (ผู้ใช้/หลักสูตร/สื่อ) ให้ admin สร้างเองผ่านหน้าระบบ หรือใช้ **bulk import CSV** (Phase 1) นำเข้ารายชื่อเจ้าหน้าที่ทีเดียว

**ข้อดีของการเริ่มใหม่:**
- ไม่มี technical debt จากโครงสร้างข้อมูลเก่า
- ไม่ต้องทำ staging dry run เรื่องข้อมูล / ไม่มี downtime cutover
- go-live ทำได้ทันทีที่ระบบพร้อม แค่ deploy + seed + แจ้งผู้ใช้

**ข้อควรระวัง:**
- ระบบเดิม (ถ้ายังเปิดอยู่) ควรประกาศวันปิด/อ่านอย่างเดียว ให้ชัดเจน กันคนสับสนว่าใช้ตัวไหน
- ถ้ามีใบรับรองเดิมที่ยังไม่หมดอายุและจำเป็นต้องอ้างอิง ให้ตัดสินใจแยกว่าจะ "ออกใหม่" หรือ "ให้ผู้ใช้อัปโหลดเป็น external cert" เอง

---

## 12. Go-Live Checklist

**ความปลอดภัย**
- [ ] HTTPS บังคับทุก endpoint
- [ ] cookie auth + refresh rotation ทำงานถูก
- [ ] rate limit + helmet + CORS ตั้งค่าแล้ว
- [ ] secrets อยู่ใน env ไม่อยู่ใน repo

**PDPA**
- [ ] หน้า privacy policy + consent flow
- [ ] สิทธิ์เจ้าของข้อมูล (ดู/แก้/ลบ) ใช้งานได้
- [ ] audit log บันทึกครบ

**ข้อมูลตั้งต้น**
- [ ] seed admin + department + cert template เรียบร้อย
- [ ] บังคับเปลี่ยนรหัส admin หลังล็อกอินครั้งแรก
- [ ] backup อัตโนมัติทำงาน + ทดสอบ restore แล้ว

**คุณภาพ**
- [ ] CI ผ่าน (typecheck/lint/test)
- [ ] E2E flow หลักผ่าน
- [ ] error tracking (Sentry) + health check ติดตั้ง

**ใช้งาน**
- [ ] ทดสอบ flow จริงกับผู้ใช้ตัวอย่าง
- [ ] เอกสารใช้งานสำหรับ admin
- [ ] แผน rollback ถ้าขึ้นแล้วมีปัญหา

---

### ขั้นถัดไปที่แนะนำ
เริ่มที่ **Phase 0** ให้รากฐานแน่นก่อน (TypeScript + Prisma schema + monorepo) เพราะทุกเฟสต่อจากนี้ build บนนั้น ถ้าพร้อมผมช่วยลงรายละเอียด Phase 0 แบบ step-by-step + เขียน `schema.prisma` ตัวเต็มที่ migrate ได้จริง หรือจะให้เริ่มจากส่วนไหนก่อนก็ได้

*เอกสารฉบับร่าง — ปรับแก้ได้ตามข้อจำกัดจริง (เวลา/งบ/ทีม)*
