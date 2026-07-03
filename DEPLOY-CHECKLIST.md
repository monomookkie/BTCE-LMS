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

## Deferred — fix in a later phase

### 2. Cert-expiry notification links to a route that doesn't exist for USER

- **Found:** FE-5a verification pass (2026-07-02), while testing notification
  click-through.
- **Symptom:** notifications created by the cert-expiry cron
  (`apps/backend/src/jobs/certExpiryReminder.ts`) set
  `link: /certificates/${cert.id}`, but the frontend has no
  `/certificates/:id` route for role USER — only `/certs` (list) and
  `/admin/certificates` (admin). Clicking the notification falls through
  the wildcard route and bounces to the dashboard instead of the cert.
- **Options:**
  - Add a `/certificates/:id` USER-facing single-certificate view (leaning
    toward this — more useful than just redirecting to the list).
  - Or change the cron to link to `/certs` instead.
- **Decision:** add the USER `/certificates/:id` route. Scope for a later
  phase, tracked here so it isn't lost.

---

## Tech debt — before next TypeScript major upgrade

### 3. `esModuleInterop: false` in `apps/backend/tsconfig.json` blocks TS 7.0 upgrade

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
