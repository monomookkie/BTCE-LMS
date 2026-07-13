# Deploy Checklist

Items found during development that must be resolved before production
deploy, or intentionally deferred to a later phase. Not a general TODO
list — only pre-deploy blockers and cross-phase follow-ups land here.

---

## Must fix before deploy

### 1. `GET /health` returns 500

- **Found:** FE-5a verification pass (2026-07-02).
- **Symptom:** `{"statusCode":500,"error":"TypeError","message":"schema.safeParse is not a function"}`.
- **Cause:** `apps/backend/src/modules/health/health.routes.ts` declares its response
  schema as raw JSON Schema, but the app's global validator/serializer
  compiler is set up for Zod (`fastify-type-provider-zod`) across the whole
  Fastify instance — not just routes using `withTypeProvider<ZodTypeProvider>()`.
  The raw JSON Schema object gets passed to the Zod compiler, which expects
  a `.safeParse` method and throws.
- **Reproduced on:** clean `main` (pre-existing, not introduced by FE-5a).
- **Why it blocks deploy:** Railway (and any uptime/liveness monitoring)
  is expected to hit `/health` — a 500 here looks like the whole service is
  down even when every real route works fine.
- **Fix:** convert `health.routes.ts`'s response schema to Zod, matching
  every other module's convention.

---

### 2. Material-completion anti-cheat gate (Tier 2/3) — steps 1-3 must ship together

- **Found:** 2026-07-06, while building server-side view-tracking for
  `POST /enrollments/:id/complete-material/:materialId`.
- **What it is:** a 3-step rollout —
  1. Backend gate (`enrollments.service.ts`'s `markMaterialComplete`) requires
     a `MaterialProgress` row showing the material was actually opened
     (`openedAt`) and, for VIDEO, watched to ≥90% (`watchedPercent`), or for
     PDF/LINK/IMAGE/DOC, opened for ≥300s — **shipped 2026-07-06**.
  2. YouTube embed + real watch-percent tracking + forward-seek blocking on
     the frontend (`CourseDetailPage.tsx`) — not yet built.
  3. PDF/LINK open-event + time-gated "Mark complete" button on the frontend
     — not yet built.
- **Why it blocks deploy:** the frontend currently calls `complete-material`
  directly with no prior call to the new `POST .../materials/:materialId/open`
  or `.../progress` endpoints. If step 1 (backend gate) reaches production
  before steps 2-3 (frontend wiring) land, **every "Mark complete" click
  returns 400** for every material type — a full regression of course
  completion, not a partial one.
- **Do not deploy step 1 alone.** Ship 1+2+3 in the same release, or gate
  step 1's enforcement behind a feature flag if they must land separately.
  Already-completed materials (recorded in `Enrollment.completedMaterials`
  before this gate existed) are grandfathered through automatically — this
  only affects materials not yet marked complete.

---

## Deferred — fix in a later phase

### 3. ~~Cert-expiry notification links to a route that doesn't exist for USER~~ — OBSOLETE

- **Found:** FE-5a verification pass (2026-07-02), while testing notification
  click-through.
- **Resolved by removal:** CERT-REMOVE-1 (2026-07-10) deleted the self-issued
  Certificate system entirely, including `apps/backend/src/jobs/certExpiryReminder.ts`
  and the cron that created these notifications. There is no longer a
  cert-expiry notification to link anywhere. Left here for history only —
  no action needed.

---

### 6. Backend dead dependencies removed from `package.json`, `pnpm install` not yet run

- **Found:** CERT-REMOVE-1 (2026-07-10), after deleting `apps/backend/src/lib/pdf.tsx`
  (system-certificate PDF generation, the only consumer of these packages).
- **What's done:** `@react-pdf/renderer`, `qrcode`, `react`, `react-dom` and their
  `@types/*` dev counterparts were removed from `apps/backend/package.json`.
  Backend `tsc --noEmit` and the full `vitest` suite (217/217) pass — the
  packages are still physically present in `node_modules` on disk, just no
  longer declared.
- **Why deferred:** running `pnpm install` right now wants to fully wipe and
  reinstall the monorepo's `node_modules` from scratch, because
  `pnpm-workspace.yaml` has an unfilled `allowBuilds` placeholder (separate
  known issue — see that file). A full reinstall mid-way through concurrent
  work (CERT-REMOVE, course form, survey work) risks breaking other
  dependencies and burning time debugging an unrelated toolchain issue.
- **`pnpm-lock.yaml` is currently stale relative to `package.json`** — this is
  acceptable short-term since `node_modules` already on disk still satisfies
  both dev and CI (nothing was physically removed), but must not ship to
  production in this state.
- **Before deploy:** fix the `pnpm-workspace.yaml` `allowBuilds` placeholder,
  then run `pnpm install` (full reinstall) as part of a pre-deploy cleanup
  batch, together with any other accumulated dependency changes. After
  reinstall, re-verify backend `tsc --noEmit` + `vitest run` still pass
  against the fresh `node_modules`.

---

### 7. `ASSIGNED` enrollment status — dead enum value, never created going forward

- **Found:** 2C-3 (2026-07-13), while removing `assignEnrollment` (the ADMIN
  manual-assign endpoint, confirmed unused by any frontend page).
- **What it is:** `assignEnrollment` was the only code path that ever created
  an `Enrollment` with `status: 'ASSIGNED'`. Now that it's deleted, the sole
  remaining creation path (`selfEnroll`) always creates `IN_PROGRESS` —
  `ASSIGNED` can never be produced by the application again.
- **Currently harmless:** `ASSIGNED` is still a valid Prisma enum member
  (`apps/backend/prisma/schema.prisma`'s `EnrollStatus`), still accepted by
  3 separately-declared Zod enums (`packages/shared/src/schemas/enrollment.schema.ts`,
  `packages/shared/src/schemas/report.schema.ts`, `apps/backend/src/modules/reports/reports.schema.ts`
  — not sharing one source of truth), and still rendered/filterable in the
  frontend (`statusMaps.ts` gray badge, `ReportsPage.tsx` status filter
  dropdown, `UserDashboardPage.tsx` counts it alongside `IN_PROGRESS`). None
  of this is broken — it just represents data that can no longer be created
  new, only inherited from legacy/manually-inserted rows.
- **Deliberately not removed in 2C-3/2C-4:** stripping the enum value is a
  breaking change touching the DB enum + 3 duplicated Zod schemas + frontend
  UI (dropdown option, badge color, i18n labels) simultaneously — out of
  scope for those phases.
- **Before deploy:** decide whether to (a) leave `ASSIGNED` permanently as a
  legacy-only value (cheapest, no risk), or (b) do a dedicated cleanup pass
  removing it from the enum + all 3 Zod duplicates + frontend UI, and while
  at it consider consolidating the 3 duplicated status enums into one shared
  source of truth. Bundle with item 6 (dead deps / `pnpm install`) since both
  are "accumulated cleanup, not urgent, needs its own careful pass."

---

## Tech debt — before next TypeScript major upgrade

### 4. `esModuleInterop: false` in `apps/backend/tsconfig.json` blocks TS 7.0 upgrade

- **Found:** 2026-07-04, while silencing the TS 6.0 deprecation warning on
  `esModuleInterop: false`.
- **Symptom:** TS 7.0 will remove support for `esModuleInterop: false`
  entirely (currently silenced via `"ignoreDeprecations": "5.0"`).
- **Cause:** flipping the flag to `true` today produces 85 type errors,
  all cascading from `apps/backend/src/lib/logger.ts`'s
  `import pino from 'pino'` resolving to a different pino type shape that
  no longer structurally matches `FastifyBaseLogger` — breaks every
  `FastifyInstance<...>` generic that threads the logger through (visible
  first in `users.test.ts`'s `app.inject()` calls, but affects the whole
  Fastify route/test surface).
- **Before upgrading to TS 7.0:** fix the pino/Fastify logger typing so the
  app compiles clean with `esModuleInterop: true`, then remove both
  `esModuleInterop: false` and `"ignoreDeprecations": "5.0"` from
  `apps/backend/tsconfig.json`.

---

## Optional polish — after REFACTOR-2

### 5. No audit log on `GET /reports/compliance` (compliance list view)

- **Found:** endpoint-security-review during REFACTOR-1 (department removal),
  2026-07-04.
- **Symptom:** `getComplianceList` (`apps/backend/src/modules/reports/reports.service.ts`)
  returns row-level PII (user name, course, enrollment/cert status) for every
  matching enrollment with no `AuditLog` entry — only the CSV export path
  (`REPORT_EXPORT`) is audited. This predates REFACTOR-1; not a regression.
- **Why it's parked:** during REFACTOR-1, MANAGER temporarily lost
  department scoping (sees all users, same as ADMIN) until REFACTOR-2 removes
  the MANAGER role entirely. Once R2 lands, only ADMIN — who already has
  legitimate system-wide visibility — reaches this endpoint, so the gap
  shrinks on its own.
- **Optional after R2:** add an audit log entry (e.g. `REPORT_COMPLIANCE_VIEW`)
  to `getComplianceList` for consistency with the export path, since ADMIN
  reading a large PII batch is worth logging even when authorized. Not a
  blocker — nice-to-have.
