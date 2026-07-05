# BTEC LMS v2 — Frontend Architecture

เอกสารสถาปัตยกรรม frontend สำหรับ BTEC LMS v2
หน้าตา = template เดิม (navy/brand, DM Sans) · โครงข้างใน = stack ใหม่ (TS + TanStack Query + cookie auth + i18n)

---

## 1. หลักการ (Principles)

1. **Design เดิม, โครงใหม่** — replicate look & feel ของ frontend เดิม (navy gradient sidebar, brand blue `#1A56DB`, DM Sans, badge pill มี border, การ์ด rounded-xl/2xl) แต่เขียนใหม่บน TypeScript strict
2. **API เป็นแหล่งความจริงเดียว** — frontend ไม่ถือ business logic ซ้ำ; ดึง/ส่งผ่าน backend ที่ทำเสร็จแล้วทั้งหมด
3. **Server state ผ่าน TanStack Query** — ไม่เก็บ server data ใน global store เอง; cache/refetch/invalidate ให้ Query จัดการ
4. **i18n ทุกข้อความ** — ไม่ hardcode string ใน JSX; ผ่าน `t()` key เสมอ (ตาม CLAUDE.md Convention #11)
5. **Role-based ทุกชั้น** — routing, layout, การแสดง component แยกตาม ADMIN/MANAGER/USER; ไม่พึ่ง frontend เป็นด่านความปลอดภัย (backend เป็นด่านจริง) แต่ frontend ต้องไม่แสดงสิ่งที่ role ไม่มีสิทธิ์
6. **Component composability** — UI primitive (Badge, Card, Button, Input…) reuse ทุกหน้า; หน้าใหม่ประกอบจาก primitive ไม่เขียนซ้ำ

---

## 2. Stack

| ส่วน | เลือกใช้ | เหตุผล |
|------|---------|--------|
| Framework | React 18 + Vite + TypeScript (strict) | มีอยู่แล้วจาก i18n step 4 |
| Styling | Tailwind CSS (ล้วน, เขียน component เอง) | ตรง design เดิม, ควบคุมเต็มที่ |
| Server state | TanStack Query (React Query) v5 | cache/refetch/optimistic, มาตรฐาน |
| Routing | React Router v6 | role guard + nested layout |
| Forms | React Hook Form + Zod | reuse Zod schema จาก packages/shared |
| i18n | react-i18next | มีอยู่แล้ว (type-safe keys) |
| HTTP | fetch wrapper (apiFetch) | มีอยู่แล้ว (Accept-Language interceptor) |
| Icons | lucide-react หรือ icon set เดิม | (เดิมใช้ Icon.jsx custom) |

---

## 3. โครงสร้างโฟลเดอร์

```
apps/frontend/src/
├── main.tsx                    # entry (มี QueryClientProvider, i18n, Router)
├── App.tsx                     # root routes + role guard
├── api/
│   ├── client.ts               # apiFetch wrapper (มีแล้ว — Accept-Language)
│   ├── auth.ts                 # login, logout, me, refresh
│   ├── courses.ts              # course endpoints
│   ├── enrollments.ts
│   ├── quizzes.ts
│   ├── certificates.ts
│   ├── reports.ts
│   ├── announcements.ts
│   ├── notifications.ts
│   └── users.ts
├── hooks/
│   ├── useAuth.ts              # current user, login/logout (TanStack Query)
│   ├── useLanguage.ts          # มีแล้ว (i18n sync)
│   └── queries/                # TanStack Query hooks ต่อ domain
│       ├── useCourses.ts
│       ├── useEnrollments.ts
│       ├── useCertificates.ts
│       └── ...
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx         # navy gradient, nav ตาม role
│   │   ├── TopBar.tsx          # จุดเขียว + language switcher + bell + role badge
│   │   ├── AdminLayout.tsx     # sidebar + topbar + outlet
│   │   └── UserLayout.tsx      # (USER ใช้ layout เดียวกันได้ — nav ต่าง)
│   ├── ui/                     # primitives (design เดิม)
│   │   ├── Badge.tsx           # 6 variant pill มี border
│   │   ├── Button.tsx          # brand / outline / ghost
│   │   ├── Card.tsx            # white rounded-xl border-slate-100
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── Toast.tsx
│   │   ├── Skeleton.tsx
│   │   ├── Avatar.tsx
│   │   ├── ProgressBar.tsx     # brand-500 fill
│   │   ├── StatCard.tsx        # การ์ดตัวเลข + ไอคอน
│   │   ├── StatusBadge.tsx     # map สถานะ → Badge variant
│   │   ├── DataTable.tsx       # ตาราง + pagination
│   │   └── LanguageSwitcher.tsx # มีแล้ว
│   └── domain/                 # component เฉพาะ domain
│       ├── CourseCard.tsx
│       ├── CertCard.tsx
│       ├── QuizRunner.tsx
│       └── ComplianceTable.tsx
├── pages/
│   ├── auth/
│   │   └── LoginPage.tsx       # navy gradient bg, card gradient header
│   ├── ProfilePage.tsx
│   ├── verify/
│   │   └── VerifyPage.tsx      # public — ไม่ต้อง login
│   ├── user/
│   │   ├── UserDashboard.tsx
│   │   ├── BrowseCourses.tsx
│   │   ├── CourseDetail.tsx    # เรียน material + ทำ quiz
│   │   ├── MyCertificates.tsx
│   │   └── MyReport.tsx
│   └── admin/
│       ├── AdminDashboard.tsx
│       ├── CourseManagement.tsx
│       ├── CertificateEngine.tsx
│       ├── UsersPage.tsx
│       ├── Reports.tsx
│       └── Announcements.tsx
├── lib/
│   ├── queryClient.ts          # TanStack Query config
│   ├── statusMaps.ts           # สถานะ → สี/label (cert, enrollment)
│   └── format.ts               # วันที่ (Buddhist era), ตัวเลข
└── i18n/                       # มีแล้ว (locales/en.json, th.json)
```

---

## 4. Routing + Role Guard

```
/ (public)
├── /login                      → LoginPage
├── /verify/:hash               → VerifyPage (public — ตรวจ cert ไม่ต้อง login)
│
├── [USER guard]
│   ├── /dashboard              → UserDashboard
│   ├── /courses                → BrowseCourses
│   ├── /courses/:id            → CourseDetail (material + quiz)
│   ├── /certs                  → MyCertificates
│   ├── /report                 → MyReport
│   └── /profile                → ProfilePage
│
└── [ADMIN/MANAGER guard]
    ├── /admin/dashboard        → AdminDashboard
    ├── /admin/courses          → CourseManagement
    ├── /admin/certificates     → CertificateEngine
    ├── /admin/users            → UsersPage (ADMIN only)
    ├── /admin/reports          → Reports (MANAGER = dept scope)
    └── /admin/announcements    → Announcements
```

**Guard pattern:**
- `<RequireAuth>` — ตรวจ `useAuth()` มี user; ไม่มี → redirect `/login`
- `<RequireRole roles={['ADMIN','MANAGER']}>` — role ไม่ตรง → redirect ไป dashboard ของ role ตัวเอง
- หลัง login: ADMIN/MANAGER → `/admin/dashboard`, USER → `/dashboard`
- MANAGER เห็นเมนูเหมือน ADMIN ยกเว้น User Directory (ADMIN only); ข้อมูลใน Reports ถูก scope ที่ backend อยู่แล้ว

---

## 5. Auth flow (cookie-based)

1. **Login** — POST `/auth/login` → backend set httpOnly cookie (access + refresh); frontend ไม่เก็บ token เอง
2. **Current user** — GET `/auth/me` → `useAuth` cache user (role, language, name)
3. **ทุก request** — credentials: 'include' (ส่ง cookie อัตโนมัติ) + Accept-Language header (มีแล้ว)
4. **Token หมดอายุ** — apiFetch จับ 401 → เรียก POST `/auth/refresh-token` → retry คำขอเดิม; ถ้า refresh fail → logout → `/login`
5. **Logout** — POST `/auth/logout` → backend ล้าง cookie → clear Query cache → `/login`

> ต่างจากเดิม: frontend เก่าเก็บ JWT ใน sessionStorage (ไม่ปลอดภัย) — ใหม่ใช้ httpOnly cookie ทั้งหมด, frontend แตะ token ไม่ได้เลย

---

## 6. ดีไซน์ที่ replicate จากเดิม (Design Tokens)

```js
// tailwind.config — extend
fontFamily: { sans: ['DM Sans','sans-serif'], mono: ['DM Mono','monospace'] }
colors: {
  brand: { 50:'#EEF3FF', 100:'#D9E4FF', 500:'#1A56DB', 600:'#1445B8', 700:'#0D329A' },
  navy:  { 900:'#0D1B2A', 800:'#1A3A5C', 700:'#2D4057' },
  danger: '#C0392B',
}
```

**ลายเซ็นดีไซน์:**
- **Sidebar** — `linear-gradient(180deg,#0D1B2A,#1A3A5C)`, กว้าง ~200px, nav active = `bg-brand-500/20 text-white`, logo บนสุด, user + logout ล่างสุด
- **TopBar** — ขาว, สูง ~52px, จุดเขียว `emerald-500` + ชื่อหน้า, ขวา = language switcher + bell + role badge
- **Card** — `bg-white rounded-xl border border-slate-100`
- **Badge** — pill `rounded-full border`, 6 variant: blue/green(emerald)/red/amber/purple/gray ใช้ `{color}-50` bg / `{color}-700` text / `{color}-100` border
- **Login** — พื้นหลัง `linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)`, การ์ดขาว rounded-2xl, header gradient navy
- **ProgressBar** — track `slate-100`, fill `brand-500`
- **ปุ่มหลัก** — `bg-brand-500 hover:bg-brand-600 text-white rounded-xl`

**ส่วนที่เพิ่มจากเดิม (backend ใหม่รองรับ):**
- Language switcher EN·ไทย ทุกหน้า
- MANAGER role (เดิมมีแค่ ADMIN/USER) — เมนู + dept scope
- Cert expiry / recertification UI (การ์ด navy "ต้องต่ออายุเร็ว ๆ นี้")
- Notification center (bell + จุดแดง)
- Public verify page

---

## 7. State management

| ชนิด state | เก็บที่ไหน |
|-----------|----------|
| Server data (course, cert, report…) | TanStack Query cache |
| Current user / auth | TanStack Query (`useAuth`) — key `['auth','me']` |
| ภาษา (UI locale) | i18next + localStorage (มีแล้ว) |
| Form state | React Hook Form (local) |
| UI ephemeral (modal open, toast) | useState / context เล็ก ๆ |

**ไม่ใช้** Redux/Zustand — server state ให้ Query, UI state ให้ useState พอ

**Query key convention:**
```
['courses', filters]         ['course', id]
['enrollments','me']         ['certificates','me']
['reports','dashboard', dept] ['notifications','me']
```
mutation สำเร็จ → `invalidateQueries` key ที่เกี่ยว (เช่น submit quiz → invalidate `['enrollments','me']` + `['certificates','me']`)

---

## 8. แผนการ build (Phase ย่อย)

| Phase | ขอบเขต | ผลลัพธ์ |
|-------|--------|---------|
| **FE-0** | Setup: Tailwind config (design tokens), queryClient, router skeleton, api client ต่อ auth | รันได้, login จริงผ่าน cookie |
| **FE-1** | UI primitives ครบ (Badge, Button, Card, Input, Modal, ProgressBar, StatCard, StatusBadge, DataTable, Toast) + layout (Sidebar, TopBar) | component library พร้อม, ดู Storybook-like ได้ |
| **FE-2** | Auth: LoginPage + guard + useAuth + refresh flow | login/logout/refresh ครบ, redirect ตาม role |
| **FE-3** | USER: dashboard, browse courses, course detail (material + quiz runner), my certs, my report | USER ใช้งานครบ flow เรียน→สอบ→ได้ cert |
| **FE-4** | ADMIN/MANAGER: dashboard, course mgmt, cert engine, users, reports (dept scope), announcements | admin จัดการระบบครบ |
| **FE-5** | Public verify page + notification center + polish (loading, error, empty states, responsive) | ครบทั้งระบบ |

แต่ละ phase: build → review → commit (เหมือน backend)

---

## 9. จุดที่ต้องระวัง (เรียนจาก backend)

1. **bilingual content** — course/cert/announcement มี field localized (`title`) มาแล้วจาก backend (Convention #12); frontend ใช้ `title` ตรง ๆ ไม่ต้อง fallback เอง (backend ทำ localizeField แล้ว) — admin edit form เท่านั้นที่ดึง raw `titleEn/titleTh`
2. **role-based response** — USER ไม่ได้ field admin (verifyHash, raw En/Th); อย่าเขียน frontend คาดหวัง field ที่ role นั้นไม่ได้
3. **cert status** — ใช้ status ที่ backend คำนวณ (`valid/expiring-soon/expired/revoked`) ไม่คำนวณเองที่ frontend
4. **quiz isCorrect** — `/take` ไม่มี isCorrect (backend strip แล้ว); frontend แสดงผลเฉลยได้เฉพาะหลัง submit จาก response attempt
5. **public verify** — หน้านี้ห้ามเรียก endpoint ที่ต้อง auth; ใช้แค่ GET `/verify/:hash`
6. **วันที่** — แสดงพุทธศักราชให้ผู้ใช้ไทย (เช่น 2569) แต่เก็บ/ส่ง ISO ให้ backend

---

## 10. หน้าตา (ยืนยันแล้วผ่าน mockup)

- **Login** — navy gradient + การ์ดขาว gradient header ✓
- **Admin dashboard** — sidebar navy + StatCard + compliance + การ์ด navy recertification + progress ✓
- **User dashboard** — topbar + StatCard + course progress + cert cards (ทำ mockup เพิ่มได้)

ดีไซน์ที่เหลือ (course detail, quiz runner, cert engine) จะ replicate ตาม token เดียวกันตอน build แต่ละ phase
