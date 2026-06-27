# Build Prompt — BTEC LMS v2

> วางทั้งก้อนนี้เป็น prompt แรกใน Claude Code (หรือบันทึกเป็น `CLAUDE.md` ที่ root ของโปรเจกต์เพื่อให้เป็น context ถาวร)
> ปรับชื่อ/ค่าในวงเล็บเหลี่ยม `[...]` ให้ตรงของจริงก่อนใช้

---

## บทบาทและเป้าหมาย

คุณคือ senior full-stack engineer ที่กำลังสร้างระบบ **BTEC LMS v2** ระบบจัดการการเรียนรู้และการอบรม (LMS) สำหรับเจ้าหน้าที่ **ศูนย์บริการโลหิตแห่งชาติ สภากาชาดไทย** ใช้งานจริงระดับ production

นี่คือการเขียนใหม่ทั้งหมด (greenfield) **ไม่ดึงข้อมูลจากระบบเดิม** เริ่มฐานข้อมูลใหม่หมด

เป้าหมาย: ระบบที่ปลอดภัย, รองรับ PDPA, maintainable, type-safe ทั้ง stack และมี test ครอบคลุม logic สำคัญ

---

## Stack ที่ล็อกไว้แล้ว (ห้ามเปลี่ยนโดยไม่ถาม)

- **ภาษา:** TypeScript เต็มตัว ทั้ง frontend และ backend (strict mode)
- **Monorepo:** pnpm workspace + Turborepo
- **Frontend:** React 18 + Vite + Tailwind CSS + React Router v6 + TanStack Query + React Hook Form + Zod
- **Backend:** Fastify + TypeScript
- **Validation:** Zod ผูกเป็น route schema ผ่าน `fastify-type-provider-zod` และ share schema กับ frontend ผ่าน package `shared/`
- **DB:** MariaDB/MySQL + Prisma ORM
- **Auth:** `@fastify/jwt` + `@fastify/cookie` (httpOnly, Secure, SameSite) + refresh token rotation (เก็บ hash ใน DB)
- **File storage:** Cloudinary ผ่าน `@fastify/multipart` — **ห้ามเก็บไฟล์เป็น base64 ใน DB เด็ดขาด** เก็บแค่ key
- **Email:** Resend (nodemailer)
- **PDF cert:** `@react-pdf/renderer` หรือ Puppeteer (gen on-demand)
- **Logging:** pino (built-in ของ Fastify)
- **Testing:** Vitest + `app.inject()` (integration) + Playwright (e2e)
- **Deploy:** Vercel (FE) + Railway (BE) + GitHub Actions CI

---

## โครงสร้างโปรเจกต์เป้าหมาย

```
btec-lms/
├── package.json            # pnpm workspace root
├── turbo.json
├── docker-compose.yml      # MariaDB + adminer สำหรับ dev
├── packages/shared/        # Zod schema + type ที่ FE-BE ใช้ร่วมกัน
├── apps/frontend/          # React + Vite + TS
├── apps/backend/           # Fastify + TS + Prisma
│   └── src/
│       ├── server.ts       # entry: เรียก buildApp() แล้ว listen
│       ├── app.ts          # buildApp() — แยกไว้ test ด้วย inject()
│       ├── config/env.ts   # validate env ด้วย Zod
│       ├── lib/            # prisma, storage, mailer, pdf
│       ├── plugins/        # auth, rbac, rateLimit, security, prisma (ห่อด้วย fastify-plugin)
│       ├── hooks/          # audit (onResponse)
│       ├── modules/        # auth, users, courses, enrollments, quizzes, certificates, trainingLogs, announcements, reports
│       │   └── <name>/     # <name>.routes.ts, <name>.service.ts, <name>.schema.ts
│       └── jobs/           # certExpiryReminder.ts
└── .github/workflows/      # ci.yml, deploy.yml
```

---

## Convention ที่ต้องยึดเสมอ

1. **TypeScript strict** — ห้ามใช้ `any` ถ้าเลี่ยงได้ ห้าม `@ts-ignore` โดยไม่มีคอมเมนต์อธิบาย
2. **Zod เป็น source of truth** — schema อยู่ใน `packages/shared` ใช้ทั้ง validate ฝั่ง backend และ form ฝั่ง frontend
3. **Fastify plugin ที่ต้องใช้ทั้งแอป ต้องห่อด้วย `fastify-plugin`** ไม่งั้นจะติด encapsulation scope
4. **ห้ามเก็บไฟล์เป็น base64** — อัปโหลดขึ้น object storage เก็บแค่ `fileKey` เสิร์ฟผ่าน signed URL
5. **Soft delete** — ตารางสำคัญใช้ `deletedAt` ไม่ลบจริง และ query ต้อง filter `deletedAt: null`
6. **Audit log** — ทุก action ที่แก้ข้อมูลสำคัญ (สร้าง/แก้/ลบ user, ออก cert ฯลฯ) ต้องบันทึกลง `AuditLog`
7. **แยก business logic ออกจาก route** — logic อยู่ใน `*.service.ts`, route แค่ validate + เรียก service
8. **Secrets อยู่ใน env เท่านั้น** — ไม่ hardcode, validate env ด้วย Zod ตอน boot, ไม่ commit `.env`
9. **RBAC 3 ระดับ:** ADMIN / MANAGER / USER ตรวจผ่าน decorator `requireRole`
10. **คอมเมนต์ภาษาไทยได้** ในจุดที่ช่วยให้ทีมอ่านง่าย แต่ identifier ทั้งหมดเป็นภาษาอังกฤษ

---

## วิธีทำงาน (สำคัญ)

- **ทำทีละเฟสตามลำดับด้านล่าง อย่ารวบทำทุกอย่างพร้อมกัน** จบแต่ละเฟสให้สรุปสิ่งที่ทำ + วิธีทดสอบ แล้วรอผมยืนยันก่อนขึ้นเฟสถัดไป
- ก่อนเขียนโค้ดเฟสใด ให้บอกแผนสั้น ๆ ว่าจะสร้าง/แก้ไฟล์อะไรบ้าง
- หลังเขียนโค้ด ให้รัน `tsc --noEmit`, lint, และ test ที่เกี่ยวข้องให้ผ่านก่อนบอกว่าเสร็จ
- ถ้ามีการตัดสินใจที่กระทบสถาปัตยกรรมหรือ schema ให้ **ถามก่อน** อย่าเดา
- commit แยกตามเฟส เขียน commit message สื่อความหมาย (เช่น `feat(auth): cookie-based login with refresh rotation`)
- ถ้าอะไรในแผนขัดกับ best practice ที่คุณเห็น ให้ทักท้วงพร้อมเหตุผล

---

## เฟสการพัฒนา

### Phase 0 — รากฐาน
ตั้ง monorepo (pnpm + Turborepo), TypeScript config (strict), ESLint + Prettier + Husky pre-commit, `docker-compose.yml` (MariaDB + adminer), Prisma schema ใหม่ทั้งหมด + migration แรก + `seed.ts`, package `shared/` พร้อม Zod schema กลาง, env validation, Fastify app skeleton: `buildApp()` + ลงทะเบียน plugin หลัก (cookie, jwt, helmet, cors, rate-limit, multipart, type-provider-zod), lib พื้นฐาน (prisma, logger)
**Done เมื่อ:** `pnpm dev` รันได้, DB migrate + seed ผ่าน, health check endpoint ตอบ 200

### Phase 1 — Auth & User
Register/Login ด้วย httpOnly cookie + refresh rotation, auth plugin + `requireRole` decorator + rate limit, profile + เปลี่ยนรหัส, CRUD user (admin) + soft delete, bulk import CSV, consent + audit log hook
**Done เมื่อ:** ล็อกอินได้, role guard ทำงาน, audit log บันทึก, integration test ผ่าน

### Phase 2 — Course & Material
CRUD course + draft/publish/archive, อัปโหลดไฟล์ไป object storage (signed URL), material หลายชนิด + reorder, ตั้ง `expiryMonths` ต่อหลักสูตร
**Done เมื่อ:** อัปโหลดไฟล์เก็บใน storage (ไม่ใช่ DB), CRUD ครบ

### Phase 3 — Enrollment & Quiz
ลงทะเบียน/มอบหมาย (assign) + due date, ติดตาม progress รายสื่อ, quiz engine (Question/Option/QuizAttempt) สุ่มข้อ + จำกัดครั้งสอบ + auto-grade
**Done เมื่อ:** flow เรียน→สอบ→ผ่าน/ไม่ผ่าน ทำงานครบ, test การคิดคะแนนผ่าน

### Phase 4 — Certificate & Compliance
ออก cert อัตโนมัติเมื่อผ่านเกณฑ์, gen PDF on-demand (เก็บใน storage), cert expiry + cron แจ้งเตือนใกล้หมดอายุ (email + in-app), external cert, public verification ด้วย certNumber/QR
**Done เมื่อ:** ได้ cert PDF จริง, ตรวจสอบ public ได้, แจ้งเตือนหมดอายุทำงาน

### Phase 5 — Reporting & Polish
Dashboard analytics (admin/manager), compliance report, announcement + notification center, email integration, accessibility + responsive, test ส่วนสำคัญ + CI/CD เต็มรูปแบบ
**Done เมื่อ:** report ใช้งานได้, CI ผ่านครบ, e2e flow หลักผ่าน

---

## Database — ใช้ schema นี้เป็นจุดเริ่ม (Phase 0)

โมเดลหลัก: `User`, `Department`, `RefreshToken`, `Course`, `Material`, `Quiz`, `Question`, `Option`, `QuizAttempt`, `Enrollment`, `Certificate`, `TrainingLog`, `TrainingAttendee`, `Announcement`, `AuditLog`, `Consent`, `Notification`

หลักการสำคัญของ schema:
- ทุกตารางสำคัญมี `createdAt`/`updatedAt` และตารางที่ลบได้มี `deletedAt`
- ไฟล์ทุกที่เก็บเป็น `fileKey` (object storage) ไม่ใช่ base64
- ข้อสอบแยกเป็นตารางจริง (`Quiz`/`Question`/`Option`/`QuizAttempt`) ไม่ใช่ JSON ก้อนเดียว
- `Certificate` มี `expiresAt`, `revokedAt`, `verifyHash` (สำหรับ public verify)
- มี `AuditLog`, `Consent` (PDPA), `Notification`

> schema เต็มอยู่ในเอกสารแผน (BTEC-LMS-v2-Development-Plan.md หัวข้อ 5) — ถ้ามีไฟล์นั้นในโปรเจกต์ให้อ่านใช้เป็นต้นแบบ ถ้าไม่มีให้ขอจากผม

---

## ความปลอดภัย & PDPA (ห้ามข้าม)

- httpOnly + Secure + SameSite cookie, refresh token เก็บเป็น hash
- password hash ด้วย argon2 (หรือ bcrypt rounds ≥ 12)
- rate limit ที่ auth endpoints, helmet, CORS เฉพาะ origin ของ FE, CSRF protection
- PDPA: consent log + เวอร์ชัน policy, สิทธิ์เจ้าของข้อมูล (ดู/แก้/ลบตัวเอง), audit log การเข้าถึงข้อมูลส่วนบุคคล
- ไฟล์อัปโหลด: จำกัดชนิด/ขนาด, เสิร์ฟผ่าน signed URL

---

## ข้อมูลตั้งต้น (seed)

สร้างผ่าน `seed.ts`: บัญชี admin 1 บัญชี (รหัสอ่านจาก env, บังคับเปลี่ยนหลังล็อกอินแรก), department จริงของศูนย์ฯ, cert template ค่าเริ่มต้น, หลักสูตรตัวอย่าง 1 หลักสูตร (optional ไว้ทดสอบ)

---
