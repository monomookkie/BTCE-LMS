import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Transition } from './Transition.js'

const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 4
const PANEL_MAX_HEIGHT = 280
const PANEL_MAX_WIDTH = 320
const OPTION_ROW_HEIGHT = 30
const LIST_PADDING = 8

interface Placement {
  vertical: 'bottom' | 'top'
  horizontal: 'left' | 'right'
  maxHeight: number
  maxWidth: number
  minWidth: number
}

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  // โชว์ตอน value ไม่ตรง option ไหนเลย (เช่น ยังไม่เลือก) — ไม่ใช่ตัวเลือกจริง เลือกไม่ได้
  // ต่างจาก option ที่ value === '' (เช่น "ทั้งหมด" ใน filter) ซึ่งเป็นตัวเลือกจริงอยู่ใน options[]
  placeholder?: string | undefined
  label?: string | undefined
  error?: string | undefined
  disabled?: boolean | undefined
  id?: string | undefined
  className?: string | undefined
}

const TYPEAHEAD_RESET_MS = 500

export function Select({
  value,
  onChange,
  options,
  placeholder,
  label,
  error,
  disabled = false,
  id,
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [placement, setPlacement] = useState<Placement>({
    vertical: 'bottom',
    horizontal: 'left',
    maxHeight: PANEL_MAX_HEIGHT,
    maxWidth: PANEL_MAX_WIDTH,
    minWidth: 0,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<number>()

  const reactId = useId()
  const selectId = id ?? reactId
  const listboxId = `${selectId}-listbox`

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  // click outside ปิด
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // เลื่อน active option ที่ highlight ให้อยู่ใน viewport ของ listbox เสมอ
  useEffect(() => {
    if (!open) return
    const activeEl = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  // กัน panel ล้นขอบ viewport — เช็คพื้นที่รอบ trigger แล้วเลือกทิศเปิด (flip) + จำกัดความสูง/กว้าง
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return

    const computePlacement = () => {
      const rect = triggerRef.current!.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - TRIGGER_GAP
      const spaceAbove = rect.top - VIEWPORT_MARGIN - TRIGGER_GAP
      // ใช้ความสูงจริงของ option list (ไม่ใช่ PANEL_MAX_HEIGHT เต็ม ๆ) ตอนตัดสินใจ flip
      // ไม่งั้น list สั้น ๆ (เช่น 2 ตัวเลือก) จะ flip ขึ้นบนทั้งที่พื้นที่ด้านล่างพอแสดงได้สบาย
      const contentHeight = Math.min(PANEL_MAX_HEIGHT, options.length * OPTION_ROW_HEIGHT + LIST_PADDING)
      const vertical: Placement['vertical'] =
        spaceBelow >= contentHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top'
      const maxHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT, vertical === 'bottom' ? spaceBelow : spaceAbove))

      const maxWidth = Math.min(PANEL_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
      const spaceRight = window.innerWidth - rect.left - VIEWPORT_MARGIN
      const horizontal: Placement['horizontal'] = spaceRight >= maxWidth ? 'left' : 'right'

      setPlacement({ vertical, horizontal, maxHeight, maxWidth, minWidth: rect.width })
    }

    computePlacement()
    window.addEventListener('resize', computePlacement)
    window.addEventListener('scroll', computePlacement, true)
    return () => {
      window.removeEventListener('resize', computePlacement)
      window.removeEventListener('scroll', computePlacement, true)
    }
  }, [open])

  const openList = () => {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const closeList = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const commitActive = () => {
    const option = options[activeIndex]
    if (option) onChange(option.value)
    closeList()
  }

  const runTypeahead = (char: string) => {
    window.clearTimeout(typeaheadTimerRef.current)
    typeaheadRef.current += char.toLowerCase()
    const match = options.findIndex((o) => o.label.toLowerCase().startsWith(typeaheadRef.current))
    if (match >= 0) setActiveIndex(match)
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = ''
    }, TYPEAHEAD_RESET_MS)
  }

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commitActive()
        break
      case 'Escape':
        e.preventDefault()
        closeList()
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          e.preventDefault()
          runTypeahead(e.key)
        }
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <button
          ref={triggerRef}
          id={selectId}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => (open ? closeList() : openList())}
          onKeyDown={handleTriggerKeyDown}
          className={[
            'flex w-full items-center justify-between gap-2 rounded-md border bg-slate-50 px-3 py-1.5 text-left text-sm text-slate-800',
            'transition-colors',
            'focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20',
            'disabled:cursor-not-allowed disabled:opacity-60',
            error
              ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20'
              : 'border-slate-200',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={['min-w-0 flex-1 truncate', selected ? '' : 'text-slate-400'].join(' ')}>
            {selected ? selected.label : (placeholder ?? '')}
          </span>
          <ChevronDown size={15} className="shrink-0 text-slate-400" />
        </button>

        <Transition
          show={open}
          variant="popover"
          className={[
            'absolute z-20 origin-top-left rounded-md border border-slate-100 bg-white shadow-lg',
            placement.vertical === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
            placement.horizontal === 'left' ? 'left-0' : 'right-0',
          ].join(' ')}
          style={{ maxWidth: placement.maxWidth, minWidth: placement.minWidth }}
        >
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
            className="overflow-y-auto py-1"
            style={{ maxHeight: placement.maxHeight }}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { onChange(option.value); closeList() }}
                className={[
                  'cursor-pointer truncate px-3 py-1.5 text-sm',
                  index === activeIndex ? 'bg-brand-50 text-brand-700' : 'text-slate-700',
                  option.value === value ? 'font-medium' : '',
                ].join(' ')}
                title={option.label}
              >
                {option.label}
              </li>
            ))}
          </ul>
        </Transition>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
