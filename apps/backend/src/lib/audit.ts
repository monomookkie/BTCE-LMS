import type { PrismaClient, Prisma } from '@prisma/client'

interface AuditParams {
  actorId?: string
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}

export async function logAudit(prisma: PrismaClient, params: AuditParams): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      // conditional spread หลีกเลี่ยง exactOptionalPropertyTypes + Prisma Json type conflict
      ...(params.actorId != null && { actorId: params.actorId }),
      ...(params.targetType != null && { targetType: params.targetType }),
      ...(params.targetId != null && { targetId: params.targetId }),
      ...(params.metadata != null && {
        metadata: params.metadata as Prisma.InputJsonObject,
      }),
      ...(params.ip != null && { ip: params.ip }),
      ...(params.userAgent != null && { userAgent: params.userAgent }),
    },
  })
}
