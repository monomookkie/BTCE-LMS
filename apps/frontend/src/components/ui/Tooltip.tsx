import { cloneElement, isValidElement, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  label: string
  disabled?: boolean
  children: ReactElement
}

// Custom tooltip แทน native `title` attribute (เล็ก/ช้า/ปรับสไตล์ไม่ได้) — clone ref เข้า child
// ตรงๆ แทนการห่อด้วย wrapper element เพื่อไม่ให้กระทบ layout เดิม (flex/list) ของ trigger
// render ผ่าน portal ไป document.body เพราะ sidebar มี overflow-hidden หลายชั้นจากแอนิเมชันย่อ/ขยาย
export function Tooltip({ label, disabled = false, children }: TooltipProps) {
  const ref = useRef<HTMLElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const show = () => {
    if (disabled) return
    const rect = ref.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.top + rect.height / 2, left: rect.right + 10 })
  }
  const hide = () => setCoords(null)

  if (!isValidElement(children)) return children

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref,
    onMouseEnter: show,
    onMouseLeave: hide,
  })

  return (
    <>
      {trigger}
      {!disabled && coords != null && createPortal(
        <div
          role="tooltip"
          className="animate-popover-in pointer-events-none fixed z-[100] -translate-y-1/2 whitespace-nowrap rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10"
          style={{ top: coords.top, left: coords.left }}
        >
          {label}
          <span className="absolute right-full top-1/2 -translate-y-1/2 border-[4.5px] border-transparent border-r-navy-900" />
        </div>,
        document.body,
      )}
    </>
  )
}
