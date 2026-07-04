import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react'
import type { MaterialPublicResponse } from '@btec-lms/shared'
import { MIN_WATCHED_PERCENT, MIN_READ_SECONDS } from '@btec-lms/shared'
import { Button } from '../ui/Button.js'
import {
  getMaterialProgress,
  openMaterial,
  updateMaterialProgress,
  markEmbedFailed,
} from '../../api/materials.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'
import { YoutubeVideoPlayer } from './YoutubeVideoPlayer.js'

const materialProgressKey = (enrollmentId: string, materialId: string) =>
  ['materialProgress', enrollmentId, materialId] as const

// true เมื่อเวลาผ่านไปตั้งแต่ openedAt ครบ minSeconds แล้ว — schedule ครั้งเดียวตอน threshold จะถึง (ไม่ poll ทุกวิ)
function useElapsedReady(openedAt: string | null, minSeconds: number): boolean {
  const computeReady = useCallback(() => {
    if (openedAt == null) return false
    return (Date.now() - new Date(openedAt).getTime()) / 1000 >= minSeconds
  }, [openedAt, minSeconds])

  const [ready, setReady] = useState(computeReady)

  useEffect(() => {
    setReady(computeReady())
    if (openedAt == null || computeReady()) return

    const remainingMs = minSeconds * 1000 - (Date.now() - new Date(openedAt).getTime())
    const timer = window.setTimeout(() => setReady(true), Math.max(0, remainingMs))
    return () => window.clearTimeout(timer)
  }, [openedAt, minSeconds, computeReady])

  return ready
}

interface VideoMaterialCardProps {
  material: MaterialPublicResponse
  videoId: string
  enrollmentId: string
  isDone: boolean
  isMarking: boolean
  markCompletePending: boolean
  onMarkComplete: () => void
}

// การ์ดสื่อ VIDEO ที่ parse เป็น YouTube ID ได้ — ฝังเล่นในหน้า + track การดูจริง (Tier 3)
// แทนที่ปุ่ม "Open" ลิงก์ใหม่แบบเดิม เพราะเปิดแท็บแยกแล้ว track ไม่ได้เลย
// ถ้า embed โหลดไม่สำเร็จ (network/CSP/timeout) — fallback เป็นลิงก์เปิดตรง + time-gate แบบ LINK แทน percent-gate
// (ยอมรับ track ไม่ได้ ดีกว่าปิดกั้นการเรียนจบทั้งที่เจ้าหน้าที่ดูวิดีโอไม่ได้จริงๆ)
export function VideoMaterialCard({
  material,
  videoId,
  enrollmentId,
  isDone,
  isMarking,
  markCompletePending,
  onMarkComplete,
}: VideoMaterialCardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const queryKey = materialProgressKey(enrollmentId, material.id)

  const { data: progress } = useQuery({
    queryKey,
    queryFn: () => getMaterialProgress(enrollmentId, material.id),
    staleTime: 0,
  })

  const openedRef = useRef(false)
  useEffect(() => {
    openedRef.current = false
  }, [enrollmentId, material.id])

  const openMutation = useMutation({
    mutationFn: () => openMaterial(enrollmentId, material.id),
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : t('common.error'))
    },
  })

  const progressMutation = useMutation({
    mutationFn: ({ watchedPercent, durationSeconds }: { watchedPercent: number; durationSeconds: number }) =>
      updateMaterialProgress(enrollmentId, material.id, watchedPercent, durationSeconds),
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
  })

  // เปิดครั้งแรกที่ progress query โหลดเสร็จ (ต้องรู้ enrollmentId/materialId ownership ผ่านก่อน) — idempotent ฝั่ง server
  useEffect(() => {
    if (progress != null && !openedRef.current) {
      openedRef.current = true
      openMutation.mutate()
    }
    // เรียกเฉพาะตอน progress เปลี่ยนจาก null → loaded (openMutation อ่านผ่าน ref/closure ปัจจุบันเสมอ)
  }, [progress != null])

  const [localPercent, setLocalPercent] = useState<number | null>(null)
  const [embedFailedLocal, setEmbedFailedLocal] = useState(false)

  const handleProgress = useCallback(
    (percent: number, durationSeconds: number) => {
      setLocalPercent(percent)
      progressMutation.mutate({ watchedPercent: percent, durationSeconds })
    },
    [progressMutation],
  )

  const handleSeekBlocked = useCallback(() => {
    toast.error(t('courseDetail.videoSeekBlocked'))
  }, [toast, t])

  const handleEmbedFailed = useCallback(() => {
    setEmbedFailedLocal(true)
    embedFailedMutation.mutate()
  }, [embedFailedMutation])

  const embedFailed = embedFailedLocal || (progress?.embedFailed ?? false)
  const timeGateReady = useElapsedReady(progress?.openedAt ?? null, MIN_READ_SECONDS)

  if (progress == null) {
    return (
      <li className="py-3">
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </li>
    )
  }

  const watchedPercent = localPercent ?? progress.watchedPercent
  const canComplete = embedFailed ? timeGateReady : watchedPercent >= MIN_WATCHED_PERCENT

  return (
    <li className="space-y-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-medium text-slate-700">{material.title}</p>

        {isDone ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-600">
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

      {embedFailed ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            {t('courseDetail.videoEmbedFailed')}
          </div>
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
          >
            <ExternalLink size={12} />
            {t('courseDetail.open')}
          </a>
          {!isDone && !canComplete && (
            <p className="text-xs text-slate-400">
              {t('courseDetail.videoFallbackWaitHint', { minutes: Math.ceil(MIN_READ_SECONDS / 60) })}
            </p>
          )}
        </div>
      ) : (
        <YoutubeVideoPlayer
          videoId={videoId}
          initialWatchedPercent={progress.watchedPercent}
          onProgress={handleProgress}
          onSeekBlocked={handleSeekBlocked}
          onEmbedFailed={handleEmbedFailed}
        />
      )}
    </li>
  )
}
