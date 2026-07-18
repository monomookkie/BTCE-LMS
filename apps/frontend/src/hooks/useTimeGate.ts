import { useEffect, useRef, useState } from 'react'
import { HEARTBEAT_INTERVAL_SECONDS } from '@btec-lms/shared'

interface TimeGateState {
  ready: boolean
  remainingSeconds: number
}

interface UseTimeGateOptions {
  opened: boolean
  // activeSeconds: ค่าที่ยืนยันจาก server ล่าสุด (ไม่ใช่ wall-clock) — sync ตอน mount/query data เปลี่ยน
  activeSeconds: number
  minSeconds: number
  // เรียกทุก ~HEARTBEAT_INTERVAL_SECONDS วิระหว่างอยู่หน้า + tab visible เท่านั้น — parent ยิง API เพื่อ
  // persist ค่าสะสมไปที่ server (ดู recordMaterialHeartbeat ฝั่ง backend)
  onHeartbeat: (deltaSeconds: number) => void
}

// gate ที่นับเฉพาะ "เวลาที่อยู่หน้าจริง" — หยุดนับทันทีเมื่อออกจากหน้า (unmount) หรือสลับแท็บ (visibilitychange)
// ต่างจากเวอร์ชันเดิมที่ผูกกับ wall-clock ตั้งแต่ openedAt (นับต่อแม้ปิดหน้าไปแล้ว)
export function useTimeGate({ opened, activeSeconds, minSeconds, onHeartbeat }: UseTimeGateOptions): TimeGateState {
  const secondsRef = useRef(activeSeconds)
  const unsentRef = useRef(0)
  const onHeartbeatRef = useRef(onHeartbeat)
  onHeartbeatRef.current = onHeartbeat

  const [remainingSeconds, setRemainingSeconds] = useState(() => Math.max(0, minSeconds - activeSeconds))

  // sync ค่าจาก server เมื่อยังไม่เคยนับในเซสชันนี้ (ครั้งแรกที่ opened กลายเป็น true) — กันโดนโอเวอร์ไรต์
  // ด้วยค่าเก่าถ้า query refetch ระหว่างที่กำลังนับสด (server ยังไม่เห็น heartbeat ล่าสุดที่เพิ่งส่งไป)
  const syncedRef = useRef(false)
  useEffect(() => {
    if (!opened) {
      syncedRef.current = false
      return
    }
    if (!syncedRef.current) {
      secondsRef.current = activeSeconds
      setRemainingSeconds(Math.max(0, minSeconds - activeSeconds))
      syncedRef.current = true
    }
    // deps ตั้งใจแค่ [opened] — sync ค่าเริ่มต้นเฉพาะตอน opened เปลี่ยน ไม่ใช่ทุกครั้งที่ activeSeconds ขยับจาก heartbeat
  }, [opened])

  useEffect(() => {
    if (!opened || secondsRef.current >= minSeconds) return

    let interval: number | null = null

    const flush = () => {
      if (unsentRef.current > 0) {
        onHeartbeatRef.current(unsentRef.current)
        unsentRef.current = 0
      }
    }

    const tick = () => {
      secondsRef.current = Math.min(minSeconds, secondsRef.current + 1)
      unsentRef.current += 1
      setRemainingSeconds(Math.max(0, minSeconds - secondsRef.current))

      if (secondsRef.current >= minSeconds) {
        flush()
        if (interval != null) window.clearInterval(interval)
        return
      }
      if (unsentRef.current >= HEARTBEAT_INTERVAL_SECONDS) flush()
    }

    const start = () => {
      if (interval != null) return
      interval = window.setInterval(tick, 1000)
    }
    const stop = () => {
      if (interval != null) {
        window.clearInterval(interval)
        interval = null
      }
      flush()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stop()
    }
    // deps ตั้งใจแค่ [opened, minSeconds] — onHeartbeat อ่านผ่าน ref เสมอ (onHeartbeatRef) ไม่ต้องอยู่ใน deps
  }, [opened, minSeconds])

  return { ready: remainingSeconds <= 0, remainingSeconds }
}
