import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  label: string
  disabled?: boolean
  children: ReactElement
  // 'top' (ค่าเริ่มต้น) เหมาะกับปุ่ม action เรียงแนวนอน (ตาราง/toolbar) — โผล่เหนือปุ่มเสมอ ไม่สลับซ้าย-ขวา
  // ให้ดูรก 'right' ไว้เฉพาะ sidebar แนวตั้งที่ชิดขอบซ้ายจอ ซึ่งทางขวาว่างพอเสมอ
  placement?: 'top' | 'right'
}

const GAP = 8
const VIEWPORT_PADDING = 8

interface Position {
  top: number
  left: number
  arrowOffset: number // ระยะจากขอบซ้าย tooltip ถึงกึ่งกลางปุ่มจริง — ลูกศรต้องชี้ตรงปุ่มเสมอแม้ tooltip โดน clamp
  placement: 'top' | 'bottom' | 'right'
}

// Custom tooltip แทน native `title` attribute (เล็ก/ช้า/ปรับสไตล์ไม่ได้) — clone ref เข้า child ตรงๆ
// แทนการห่อด้วย wrapper element เพื่อไม่ให้กระทบ layout เดิม (flex/list) ของ trigger, render ผ่าน portal
// ไป document.body เพราะบาง container (เช่น sidebar) มี overflow-hidden จากแอนิเมชันย่อ/ขยาย
//
// วางตำแหน่งแบบ 2 รอบ (เหมือน browser tooltip library ทั่วไป): รอบแรก render ไว้นอกจอเพื่อวัดขนาดจริง
// ของ label (ไม่เดา width) รอบสองค่อยคำนวณตำแหน่งที่แม่นยำ + clamp ไม่ให้ล้นขอบจอ ก่อน paint จริง
// (useLayoutEffect รันก่อน paint จึงไม่มีแฟลชตำแหน่งผิดให้เห็น)
export function Tooltip({ label, disabled = false, children, placement = 'top' }: TooltipProps) {
  const triggerRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)

  const show = () => { if (!disabled) setVisible(true) }
  const hide = () => { setVisible(false); setPos(null) }

  useLayoutEffect(() => {
    if (!visible) return
    const triggerRect = triggerRef.current?.getBoundingClientRect()
    const tooltipEl = tooltipRef.current
    if (!triggerRect || !tooltipEl) return
    const tooltipRect = tooltipEl.getBoundingClientRect()

    if (placement === 'right') {
      setPos({
        top: triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2,
        left: triggerRect.right + GAP,
        arrowOffset: 0,
        placement: 'right',
      })
      return
    }

    const centerX = triggerRect.left + triggerRect.width / 2
    let left = centerX - tooltipRect.width / 2
    left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - tooltipRect.width - VIEWPORT_PADDING))

    const fitsAbove = triggerRect.top - tooltipRect.height - GAP >= 0
    const top = fitsAbove ? triggerRect.top - tooltipRect.height - GAP : triggerRect.bottom + GAP

    setPos({ top, left, arrowOffset: centerX - left, placement: fitsAbove ? 'top' : 'bottom' })
  }, [visible, label, placement])

  if (!isValidElement(children)) return children

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: triggerRef,
    onMouseEnter: show,
    onMouseLeave: hide,
  })

  return (
    <>
      {trigger}
      {!disabled && visible && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className="animate-popover-in pointer-events-none fixed z-[100] whitespace-nowrap rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10"
          // ก่อนวัดขนาดเสร็จ (pos ยังเป็น null) วางไว้นอกจอก่อน ไม่ใช่ที่ (0,0) ซึ่งจะกระพริบให้เห็นมุมจอ
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        >
          {label}
          {pos?.placement === 'right' && (
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-[4.5px] border-transparent border-r-navy-900" />
          )}
          {pos && pos.placement !== 'right' && (
            <span
              className={[
                'absolute h-2 w-2 rotate-45 bg-navy-900',
                pos.placement === 'top' ? '-bottom-1' : '-top-1',
              ].join(' ')}
              style={{ left: pos.arrowOffset - 4 }}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
