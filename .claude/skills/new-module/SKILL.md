---
name: new-module
description: Scaffold a new backend domain module (routes + service + schema) in the BTEC LMS Fastify codebase following project conventions. Use this skill whenever you add a new feature area, resource, or domain to the backend — e.g. courses, enrollments, quizzes, certificates, reports — or whenever the user mentions creating a module, endpoint group, CRUD resource, or "add X to the backend". Use it even if the user does not say the word "module", because every backend domain in this project MUST follow the same routes/service/schema + Fastify plugin pattern, and drifting from it breaks consistency.
---

# New Backend Module — BTEC LMS

Scaffold a domain module that matches the conventions in this codebase. Every module is a Fastify plugin made of three files and is wired into `buildApp()`.

## When to use
Adding any new resource/domain to `apps/backend/src/modules/` (users, courses, enrollments, quizzes, certificates, trainingLogs, announcements, reports, etc.).

## File layout to create

```
apps/backend/src/modules/<name>/
├── <name>.schema.ts    # Zod schemas (re-export shared schemas; add backend-only ones here)
├── <name>.service.ts   # business logic — the ONLY place that touches prisma
└── <name>.routes.ts    # Fastify plugin: registers routes, validation, guards
```

Where `<name>` is singular-domain in camelCase for files but the route prefix is plural kebab (e.g. module `enrollment` → prefix `/enrollments`).

## Hard rules (do not skip)

1. **Shared Zod first.** Input/output shapes that the frontend also needs go in `packages/shared/src/schemas/`. Import them into `<name>.schema.ts`. Only backend-only schemas (e.g. internal query filters) live in the module.
2. **Service is the only DB layer.** Routes never call `prisma` directly. All `prisma` access is in `<name>.service.ts`.
3. **Soft delete.** Every read query must filter `where: { deletedAt: null }`. Delete = set `deletedAt`, never `prisma.x.delete()`.
4. **Audit log on mutations.** Every create/update/delete of meaningful data writes an `AuditLog` row (actorId, action, targetType, targetId). Prefer doing this in the service so it can't be forgotten.
5. **RBAC guard on every route.** Attach `requireRole('ADMIN' | 'MANAGER' | 'USER')` (or the `authenticate` preHandler for any-logged-in) to each route. No unguarded routes unless explicitly public (and document why).
6. **Validation via type provider.** Register routes with `fastify-type-provider-zod`. Put `schema: { body, params, querystring, response }` on every route so Fastify validates and types automatically.
7. **No base64 / no files in DB.** File inputs go through `@fastify/multipart` → object storage → store `fileKey` only.
8. **Wrap shared plugins with `fastify-plugin`** only when something must escape encapsulation; a normal module plugin should NOT be wrapped (it's registered with a prefix and stays scoped).

## Steps

1. Read an existing module (e.g. `modules/users/`) as the reference pattern before writing. Match its style exactly.
2. Create the three files following the templates below.
3. Register the module in `apps/backend/src/app.ts`:
   ```ts
   await app.register(import('./modules/<name>/<name>.routes.js'), { prefix: '/<plural-kebab>' })
   ```
4. If new shared schemas were added, export them from `packages/shared/src/schemas/index.ts`.
5. Run `pnpm --filter backend exec tsc --noEmit` and fix type errors.
6. Add at least one integration test using `app.inject()` (happy path + one auth-denied case).
7. Summarize what was created and how to test it. Stop and let the user review.

## Templates

### `<name>.schema.ts`
```ts
import { z } from 'zod'
// re-export shared shapes the frontend also uses
export { <Name>Create, <Name>Update } from '@btec/shared/schemas/<name>'

// backend-only schemas
export const <Name>ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().optional(),
})
export const <Name>Params = z.object({ id: z.string().cuid() })
```

### `<name>.service.ts`
```ts
import type { PrismaClient } from '@prisma/client'

export function make<Name>Service(prisma: PrismaClient) {
  return {
    async list(query: { page: number; q?: string }) {
      return prisma.<name>.findMany({
        where: { deletedAt: null /* + search */ },
        skip: (query.page - 1) * 20,
        take: 20,
      })
    },
    async create(actorId: string, data: /* infer from Zod */ unknown) {
      const row = await prisma.<name>.create({ data: data as any })
      await prisma.auditLog.create({
        data: { actorId, action: '<NAME>_CREATE', targetType: '<Name>', targetId: row.id },
      })
      return row
    },
    async softDelete(actorId: string, id: string) {
      const row = await prisma.<name>.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      await prisma.auditLog.create({
        data: { actorId, action: '<NAME>_DELETE', targetType: '<Name>', targetId: id },
      })
      return row
    },
  }
}
```

### `<name>.routes.ts`
```ts
import type { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { <Name>Create, <Name>ListQuery, <Name>Params } from './<name>.schema.js'
import { make<Name>Service } from './<name>.service.js'

export default async function <name>Routes(app: FastifyInstance) {
  const f = app.withTypeProvider<ZodTypeProvider>()
  const service = make<Name>Service(app.prisma)

  f.get('/', {
    preHandler: [app.requireRole('USER')],
    schema: { querystring: <Name>ListQuery },
  }, async (req) => service.list(req.query))

  f.post('/', {
    preHandler: [app.requireRole('ADMIN')],
    schema: { body: <Name>Create },
  }, async (req, reply) => {
    const row = await service.create(req.user.id, req.body)
    return reply.code(201).send(row)
  })

  f.delete('/:id', {
    preHandler: [app.requireRole('ADMIN')],
    schema: { params: <Name>Params },
  }, async (req) => service.softDelete(req.user.id, req.params.id))
}
```

> Adjust import extensions (`.js`) and the `@btec/shared` alias to whatever the project actually uses — check an existing module first and match it exactly.
