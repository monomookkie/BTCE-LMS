import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search } from 'lucide-react'
import { Transition } from './Transition.js'

// เกินเท่านี้ค่อยโชว์ช่องค้นหา — list สั้นๆ (เช่น status filter 3-4 ตัวเลือก) ไม่ต้องมีช่องค้นหาให้รก
const SEARCH_THRESHOLD = 8

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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
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
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<number>()

  const reactId = useId()
  const selectId = id ?? reactId
  const listboxId = `${selectId}-listbox`

  const showSearch = options.length > SEARCH_THRESHOLD

  const filteredOptions = useMemo(() => {
    if (!showSearch || !search.trim()) return options
    const q = search.trim().toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, search, showSearch])

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
      const searchBoxHeight = showSearch ? 38 : 0
      const contentHeight = Math.min(
        PANEL_MAX_HEIGHT,
        filteredOptions.length * OPTION_ROW_HEIGHT + LIST_PADDING + searchBoxHeight,
      )
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
    setSearch('')
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  const closeList = () => {
    setOpen(false)
    setSearch('')
    triggerRef.current?.focus()
  }

  const commitActive = () => {
    const option = filteredOptions[activeIndex]
    if (option) onChange(option.value)
    closeList()
  }

  // autofocus ช่องค้นหาทันทีที่เปิด — พิมพ์กรองได้เลยไม่ต้องคลิกเพิ่ม
  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus()
  }, [open, showSearch])

  // reset active index เมื่อผลกรองเปลี่ยน กัน index ค้างเกินขอบ list ใหม่ที่สั้นลง
  useEffect(() => {
    if (activeIndex >= filteredOptions.length) setActiveIndex(Math.max(0, filteredOptions.length - 1))
  }, [filteredOptions.length, activeIndex])

  const runTypeahead = (char: string) => {
    window.clearTimeout(typeaheadTimerRef.current)
    typeaheadRef.current += char.toLowerCase()
    const match = filteredOptions.findIndex((o) => o.label.toLowerCase().startsWith(typeaheadRef.current))
    if (match >= 0) setActiveIndex(match)
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = ''
    }, TYPEAHEAD_RESET_MS)
  }

  // ใช้ร่วมกันทั้งปุ่ม trigger (list สั้น ไม่มีช่องค้นหา โฟกัสค้างที่ปุ่ม) และช่องค้นหา
  // (list ยาว โฟกัสย้ายไปช่องค้นหาตอนเปิด) — นำทาง list เดียวกันไม่ว่าโฟกัสจะอยู่ตรงไหน
  const handleOpenKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filteredOptions.length - 1))
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
        setActiveIndex(filteredOptions.length - 1)
        break
      case 'Enter':
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
        break
    }
  }

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }

    // list ยาว: โฟกัสย้ายไปช่องค้นหาแล้ว (autoFocus) ปุ่มนี้จะไม่ได้รับ keydown ระหว่างเปิดอีก —
    // เผื่อไว้เฉยๆ ไม่ต้องทำอะไร
    if (showSearch) return

    if (e.key === ' ') {
      e.preventDefault()
      commitActive()
      return
    }
    if (e.key.length === 1 && /\S/.test(e.key) && !['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault()
      runTypeahead(e.key)
      return
    }
    handleOpenKeyDown(e)
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
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
              <Search size={14} className="shrink-0 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveIndex(0) }}
                onKeyDown={handleOpenKeyDown}
                placeholder={t('common.search')}
                className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-activedescendant={open && filteredOptions.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            className="overflow-y-auto py-1"
            style={{ maxHeight: placement.maxHeight }}
          >
            {filteredOptions.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">{t('common.noResults')}</li>
            )}
            {filteredOptions.map((option, index) => (
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
