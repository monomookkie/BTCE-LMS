import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MIN_WATCHED_PERCENT } from '@btec-lms/shared'

// ── YouTube IFrame Player API — minimal ambient types (ไม่มี @types แยก) ──────

interface YTPlayer {
  getCurrentTime(): number
  getDuration(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
  destroy(): void
}

interface YTPlayerEvent {
  target: YTPlayer
  data: number
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      playerVars?: Record<string, number | string>
      events?: {
        onReady?: (e: YTPlayerEvent) => void
        onStateChange?: (e: YTPlayerEvent) => void
      }
    },
  ) => YTPlayer
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

// โหลด script ครั้งเดียวต่อทั้งหน้าเว็บ — คอมโพเนนต์หลายตัวเรียกพร้อมกันได้ ใช้ promise เดียวกันรอ
let apiLoadPromise: Promise<void> | null = null

const API_LOAD_TIMEOUT_MS = 8000 // network/CSP บล็อก youtube.com (เช่นไฟร์วอลล์องค์กร) — ต้องไม่ค้างรอตลอดไป

function loadYoutubeIframeApi(): Promise<void> {
  if (window.YT?.Player != null) return Promise.resolve()
  if (apiLoadPromise != null) return apiLoadPromise

  apiLoadPromise = new Promise<void>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => reject(new Error('Failed to load YouTube IFrame API script'))
    document.head.appendChild(script)

    window.setTimeout(() => reject(new Error('Timed out loading YouTube IFrame API')), API_LOAD_TIMEOUT_MS)
  })
  // ถ้าล้มเหลว เคลียร์ singleton ทิ้ง — ให้ครั้งถัดไป (เช่น network กลับมาใช้ได้/เปิดวิดีโอถัดไป) ลองใหม่ได้
  // ไม่ปล่อยเป็น rejected promise ค้างตลอด session
  apiLoadPromise.catch(() => { apiLoadPromise = null })
  return apiLoadPromise
}

const POLL_MS = 1000
// เผื่อ buffering lag เล็กน้อยก่อนถือว่าเป็นการกรอไปข้างหน้า
// ยอมรับ: การกรอทีละ <2 วิซ้ำๆ ทุก tick จะไม่ถูกจับ (maxWatched ขยับตาม currentTime ได้)
// แต่ backstop คือ server-side time-ceiling (ดู enrollments.service.ts computeMaxReasonablePercent)
// ซึ่งคำนวณจากเวลาจริงที่ผ่านไปตั้งแต่ openedAt เป็นเพดานอีกชั้น ไม่ใช่แค่พึ่งกลไกฝั่ง client นี้อย่างเดียว
const SEEK_BUFFER_SECONDS = 2
const PROGRESS_SEND_INTERVAL_TICKS = 5 // ส่ง progress ไป backend ทุก ~5 วิระหว่างเล่น (ไม่ใช่ทุก tick)

interface YoutubeVideoPlayerProps {
  videoId: string
  initialWatchedPercent: number
  // durationSeconds: ความยาววิดีโอจริง (จาก player) — ส่งคู่กับทุก progress event ให้ server ใช้ทำ time-ceiling sanity check
  onProgress: (percent: number, durationSeconds: number) => void
  onSeekBlocked: () => void
  // YouTube IFrame API โหลดไม่สำเร็จ (network/CSP/timeout) — parent ต้อง fallback เป็นลิงก์เปิดตรง + time-gate
  onEmbedFailed: () => void
}

// เล่นวิดีโอ YouTube แบบฝังในหน้า + track ว่าดูถึงไหนจริง (ไม่ใช่แค่ scrubber position)
// กันกรอไปข้างหน้า: ถ้า currentTime ทิ้งห่างจาก maxWatchedTime เกิน buffer → เด้งกลับ
export function YoutubeVideoPlayer({
  videoId,
  initialWatchedPercent,
  onProgress,
  onSeekBlocked,
  onEmbedFailed,
}: YoutubeVideoPlayerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const maxWatchedSecondsRef = useRef(0)
  const durationRef = useRef(0)
  const pollHandleRef = useRef<number | null>(null)
  const tickCountRef = useRef(0)
  const lastSentPercentRef = useRef(initialWatchedPercent)
  const [displayPercent, setDisplayPercent] = useState(initialWatchedPercent)

  const sendProgressIfIncreased = useCallback(
    (percent: number, force: boolean) => {
      if (percent > lastSentPercentRef.current || (force && percent !== lastSentPercentRef.current)) {
        lastSentPercentRef.current = percent
        onProgress(percent, durationRef.current)
      }
    },
    [onProgress],
  )

  // อ่านจาก ref เสมอ (ไม่ใช่ React state) — เรียกได้จาก event handler ที่ closure เก่าได้อย่างปลอดภัย
  const computeCurrentPercent = useCallback(() => {
    const duration = durationRef.current
    if (duration <= 0) return lastSentPercentRef.current
    return Math.min(100, Math.round((maxWatchedSecondsRef.current / duration) * 100))
  }, [])

  const stopPolling = useCallback(() => {
    if (pollHandleRef.current != null) {
      window.clearInterval(pollHandleRef.current)
      pollHandleRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (pollHandleRef.current != null) return
    pollHandleRef.current = window.setInterval(() => {
      const player = playerRef.current
      if (player == null) return

      const duration = durationRef.current || player.getDuration()
      durationRef.current = duration
      const current = player.getCurrentTime()

      // กรอไปข้างหน้าเกิน buffer — เด้งกลับจุดที่ดูถึงจริง
      if (current > maxWatchedSecondsRef.current + SEEK_BUFFER_SECONDS) {
        player.seekTo(maxWatchedSecondsRef.current, true)
        onSeekBlocked()
        return
      }

      if (current > maxWatchedSecondsRef.current) {
        maxWatchedSecondsRef.current = current
      }

      if (duration > 0) {
        const percent = computeCurrentPercent()
        setDisplayPercent(percent)

        tickCountRef.current += 1
        const shouldSend =
          percent >= 100 || tickCountRef.current % PROGRESS_SEND_INTERVAL_TICKS === 0
        if (shouldSend) sendProgressIfIncreased(percent, false)
      }
    }, POLL_MS)
  }, [computeCurrentPercent, onSeekBlocked, sendProgressIfIncreased])

  useEffect(() => {
    let cancelled = false

    void loadYoutubeIframeApi().then(() => {
      if (cancelled || containerRef.current == null || window.YT == null) return

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => {
            const duration = e.target.getDuration()
            durationRef.current = duration
            maxWatchedSecondsRef.current = (initialWatchedPercent / 100) * duration
          },
          onStateChange: (e) => {
            const YT = window.YT
            if (YT == null) return
            if (e.data === YT.PlayerState.PLAYING) {
              startPolling()
            } else {
              stopPolling()
              // flush ค่าล่าสุดตอน pause/end แม้ยังไม่ครบ interval — อ่านจาก ref สดๆ ไม่ใช่ state closure เก่า
              if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
                const percent = computeCurrentPercent()
                setDisplayPercent(percent)
                sendProgressIfIncreased(percent, true)
              }
            }
          },
        },
      })
    }).catch(() => {
      if (!cancelled) onEmbedFailed()
    })

    return () => {
      cancelled = true
      stopPolling()
      playerRef.current?.destroy()
      playerRef.current = null
    }
    // สร้าง player ใหม่เฉพาะตอน videoId เปลี่ยน — callback อื่นอ่านผ่าน ref/closure ล่าสุดอยู่แล้ว
  }, [videoId])

  const hasReachedThreshold = displayPercent >= MIN_WATCHED_PERCENT

  return (
    <div className="space-y-2">
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">
          {t('courseDetail.videoWatchedPercent', { percent: displayPercent })}
        </span>
        {!hasReachedThreshold && (
          <span className="text-amber-600">
            {t('courseDetail.videoNeedMorePercent', { percent: MIN_WATCHED_PERCENT })}
          </span>
        )}
      </div>
    </div>
  )
}
