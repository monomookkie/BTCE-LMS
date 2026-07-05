import { useEffect, useState, type ReactNode } from 'react'

// คง element ไว้ในทรีจนกว่า exit animation จะเล่นจบ ก่อนค่อยถอดออกจริง
// (React unmount ทันทีตาม show จะไม่มีทางเห็น exit animation เลย)
export function useDelayedUnmount(show: boolean, durationMs: number): boolean {
  const [mounted, setMounted] = useState(show)

  useEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    const timeout = setTimeout(() => setMounted(false), durationMs)
    return () => clearTimeout(timeout)
  }, [show, durationMs])

  return mounted
}

type TransitionVariant = 'popover' | 'modal'

const DURATIONS: Record<TransitionVariant, number> = {
  popover: 120,
  modal: 150,
}

const ANIMATION_CLASSES: Record<TransitionVariant, { enter: string; exit: string }> = {
  popover: { enter: 'animate-popover-in', exit: 'animate-popover-out' },
  modal: { enter: 'animate-modal-in', exit: 'animate-modal-out' },
}

interface TransitionProps {
  show: boolean
  variant?: TransitionVariant
  className?: string
  children: ReactNode
}

// wrapper กลางสำหรับ popover/menu ที่ mount/unmount ตาม show — ใส่ origin-* เอง
// ผ่าน className ตามตำแหน่ง anchor จริงของแต่ละจุด (เช่น origin-top-right)
export function Transition({ show, variant = 'popover', className, children }: TransitionProps) {
  const mounted = useDelayedUnmount(show, DURATIONS[variant])
  if (!mounted) return null

  const { enter, exit } = ANIMATION_CLASSES[variant]
  return <div className={[className, show ? enter : exit].join(' ')}>{children}</div>
}
