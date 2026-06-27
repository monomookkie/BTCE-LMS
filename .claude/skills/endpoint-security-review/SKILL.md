---
name: endpoint-security-review
description: Review a backend endpoint/route in the BTEC LMS for security, RBAC, validation, audit logging, and PDPA compliance before it ships. Use this skill whenever the user asks to review, audit, check, or sign off on a route, endpoint, controller, or API handler — and ALSO proactively after you write or modify any backend route in this project, before telling the user it's done. This system handles personal data of Thai Red Cross staff, so every endpoint must pass this checklist; run it even if the user only says "is this ok?" about backend code.
---

# Endpoint Security & PDPA Review — BTEC LMS

Audit a Fastify route (or group of routes) against this project's production + PDPA requirements. Produce a checklist verdict, not vague prose.

## When to use
- User asks to review/audit/check an endpoint or route file.
- Immediately after writing or editing any route in `apps/backend/src/modules/**/*.routes.ts`, before reporting completion.

## How to run

1. Read the route file(s) under review, plus the matching `*.service.ts` (auth + audit often live there) and the relevant Zod schema.
2. Go through every item below. For each: mark ✅ pass, ❌ fail, or ⚠️ needs-attention, with the specific line/reason.
3. List concrete fixes for every ❌ and ⚠️.
4. Give an overall verdict: **SHIP** / **FIX FIRST**. If any ❌ touches auth, RBAC, validation, or personal-data logging → verdict is FIX FIRST.

## Checklist

### 1. Authentication
- [ ] Every non-public route has the `authenticate` preHandler (or a `requireRole` guard that implies it).
- [ ] Any route intentionally public (e.g. login, public cert verify) is clearly justified and exposes no sensitive data.
- [ ] Auth reads the httpOnly cookie — never a token from a query string or request body.

### 2. Authorization (RBAC)
- [ ] Correct `requireRole` level: ADMIN-only for user/course/cert management; MANAGER limited to their scope; USER limited to their own records.
- [ ] Ownership check: a USER can only read/modify their OWN data (e.g. `where: { userId: req.user.id }`), not by passing someone else's id. (IDOR check.)
- [ ] No privilege escalation: role/permission fields can't be set by the requester unless they're ADMIN.

### 3. Input validation
- [ ] `schema.body` / `schema.params` / `schema.querystring` present and use Zod via the type provider — no unvalidated `req.body`.
- [ ] IDs validated (`z.string().cuid()`), strings length-bounded, enums constrained, numbers `coerce`d for query params.
- [ ] No raw user input concatenated into queries (Prisma parameterizes — but check any `$queryRaw`).

### 4. Audit logging (compliance)
- [ ] Every create/update/delete writes an `AuditLog` row (actorId, action, targetType, targetId).
- [ ] Access to personal data (viewing/exporting another user's records) is logged, not just mutations.

### 5. PDPA — personal data
- [ ] Only necessary personal fields are returned (data minimization) — no leaking password hash, internal flags, or other users' data in list responses.
- [ ] Endpoints that read/modify a data subject's own data exist (access / rectify / erasure rights are reachable).
- [ ] Consent is respected where required before processing.

### 6. Soft delete
- [ ] Read queries filter `deletedAt: null`.
- [ ] Delete sets `deletedAt`, never hard-deletes.

### 7. Files
- [ ] Uploads go through `@fastify/multipart` → object storage; only a `fileKey` is stored. No base64 in DB.
- [ ] File type and size limits enforced; downloads served via signed URL, not a public bucket.

### 8. Rate limiting & abuse
- [ ] Sensitive endpoints (login, register, forgot-password, anything that emails or is brute-forceable) have `@fastify/rate-limit` applied.

### 9. Error handling & leakage
- [ ] Errors return safe messages — no stack traces, SQL, or internal paths to the client.
- [ ] 404 vs 403 chosen deliberately so existence of records isn't leaked to unauthorized users.
- [ ] Logs (pino) don't record secrets, passwords, tokens, or full personal records.

### 10. Secrets & config
- [ ] No hardcoded secrets/keys; all from validated env.

## Output format

```
## Review: <route file>

| # | Area              | Status | Note |
|---|-------------------|--------|------|
| 1 | Authentication    | ✅ / ❌ / ⚠️ | ... |
| ...                                       |

### Fixes required
- ...

### Verdict: SHIP / FIX FIRST
```

Be specific and cite line numbers or code. A clean review still lists what was checked so the user can trust the pass.
