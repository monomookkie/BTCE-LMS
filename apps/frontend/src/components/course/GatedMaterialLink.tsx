import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, ExternalLink, FileText, Image, Play } from 'lucide-react'
import type { MaterialPublicResponse, MaterialType } from '@btec-lms/shared'
import { MIN_READ_SECONDS } from '@btec-lms/shared'
import { Button } from '../ui/Button.js'
import { getMaterialProgress, openMaterial, markEmbedFailed, sendMaterialHeartbeat } from '../../api/materials.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { useTimeGate } from '../../hooks/useTimeGate.js'

const materialProgressKey = (enrollmentId: string, materialId: string) =>
  ['materialProgress', enrollmentId, materialId] as const

const MATERIAL_ICONS: Record<MaterialType, React.ReactNode> = {
  PDF:   <FileText size={15} />,
  VIDEO: <Play size={15} />,
  LINK:  <ExternalLink size={15} />,
  IMAGE: <Image size={15} />,
  DOC:   <FileText size={15} />,
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface GatedMaterialLinkProps {
  material: MaterialPublicResponse
  enrollmentId: string
  isDone: boolean
  isMarking: boolean
  markCompletePending: boolean
  onMarkComplete: () => void
}

// การ์ดสื่อ PDF/LINK/IMAGE/DOC (Tier 2 time-gate) — และ VIDEO ที่ parse YouTube ID ไม่ได้
// (reuse embed-failed path จาก VideoMaterialCard กัน dead-end — วิดีโอที่ไม่ใช่ YouTube จะไม่มีทาง
// track % ได้เลย ถ้าปล่อยให้ backend เช็ค percent-gate ตามปกติจะเรียนจบไม่ได้ตลอดไป)
// คลิกลิงก์เปิด → ยิง /open (หรือ /embed-failed สำหรับ VIDEO) → เริ่มนับเวลา 300 วิ ก่อนกด Mark complete ได้
export function GatedMaterialLink({
  material,
  enrollmentId,
  isDone,
  isMarking,
  markCompletePending,
  onMarkComplete,
}: GatedMaterialLinkProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const queryKey = materialProgressKey(enrollmentId, material.id)

  const { data: progress } = useQuery({
    queryKey,
    queryFn: () => getMaterialProgress(enrollmentId, material.id),
    staleTime: 0,
  })

  const openMutation = useMutation({
    mutationFn: () => openMaterial(enrollmentId, material.id),
    onSuccess: (updated) => {
      qc.setQueryData(queryKey, updated)
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  const embedFailedMutation = useMutation({
    mutationFn: () => markEmbedFailed(enrollmentId, material.id),
    onSuccess: (updated) => {
      qc.setQueryData(queryKey, updated)
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  const isVideoFallback = material.type === 'VIDEO'

  const handleOpenClick = useCallback(() => {
    if (isVideoFallback) {
      embedFailedMutation.mutate()
    } else {
      openMutation.mutate()
    }
  }, [isVideoFallback, embedFailedMutation, openMutation])

  const heartbeatMutation = useMutation({
    mutationFn: (deltaSeconds: number) => sendMaterialHeartbeat(enrollmentId, material.id, deltaSeconds),
    onSuccess: (updated) => {
      qc.setQueryData(queryKey, updated)
    },
    // เงียบ — heartbeat ที่พลาดบางครั้ง (network) ไม่ควร toast รบกวน จะลองใหม่ใน tick ถัดไปเอง
  })

  const opened = progress?.openedAt != null
  const handleHeartbeat = useCallback(
    (deltaSeconds: number) => heartbeatMutation.mutate(deltaSeconds),
    [heartbeatMutation],
  )
  const { ready, remainingSeconds } = useTimeGate({
    opened,
    activeSeconds: progress?.activeSeconds ?? 0,
    minSeconds: MIN_READ_SECONDS,
    onHeartbeat: handleHeartbeat,
  })

  const href = material.signedUrl ?? material.url ?? null
  const canComplete = opened && ready

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-slate-400">
          {MATERIAL_ICONS[material.type]}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-700">{material.title}</p>
          <p className="text-xs text-slate-400">
            {/* dynamic key — as never bypasses literal key check (same pattern as StatusBadge) */}
            {t(`material.types.${material.type}` as never) as string}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {href != null && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenClick}
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
            >
              <ExternalLink size={12} />
              {t('courseDetail.open')}
            </a>
          )}

          {isDone ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 size={14} />
              {t('courseDetail.completed')}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              isLoading={isMarking}
              disabled={markCompletePending || !canComplete}
              leftIcon={<Circle size={12} />}
              onClick={onMarkComplete}
            >
              {t('courseDetail.markComplete')}
            </Button>
          )}
        </div>
      </div>

      {!isDone && !canComplete && (
        <p className="pl-7 text-xs text-slate-400">
          {!opened
            ? t('courseDetail.materialNotOpenedHint')
            : t('courseDetail.materialTimeGateCountdown', { time: formatMMSS(remainingSeconds) })
          }
        </p>
      )}
    </li>
  )
}
