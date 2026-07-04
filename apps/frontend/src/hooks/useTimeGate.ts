import { useEffect, useState } from 'react'

interface TimeGateState {
  ready: boolean
  remainingSeconds: number
}

function computeState(openedAt: string | null, minSeconds: number): TimeGateState {
  if (openedAt == null) return { ready: false, remainingSeconds: minSeconds }
  const elapsed = (Date.now() - new Date(openedAt).getTime()) / 1000
  const remaining = Math.max(0, Math.ceil(minSeconds - elapsed))
  return { ready: remaining <= 0, remainingSeconds: remaining }
}

// gate ที่ผูกกับเวลาจริงตั้งแต่ openedAt — ใช้ร่วมกันทั้ง VIDEO embed-fallback และ PDF/LINK time-gate
// tick ทุก 1 วิระหว่างยังไม่ผ่านเกณฑ์ เพื่อโชว์ countdown สดๆ ว่าเหลืออีกกี่วิ (เลิก tick อัตโนมัติเมื่อ ready)
export function useTimeGate(openedAt: string | null, minSeconds: number): TimeGateState {
  const [state, setState] = useState(() => computeState(openedAt, minSeconds))

  useEffect(() => {
    const initial = computeState(openedAt, minSeconds)
    setState(initial)
    if (openedAt == null || initial.ready) return

    const interval = window.setInterval(() => {
      const next = computeState(openedAt, minSeconds)
      setState(next)
      if (next.ready) window.clearInterval(interval)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [openedAt, minSeconds])

  return state
}
