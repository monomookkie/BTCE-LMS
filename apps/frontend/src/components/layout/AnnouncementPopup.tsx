import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDelayedUnmount } from '../ui/Transition.js'
import { useAuth, ANNOUNCEMENT_POPUP_PENDING_KEY } from '../../hooks/useAuth.js'
import { getLatestAnnouncement } from '../../api/announcements.js'

// เด้งทุกครั้งที่ login สำเร็จ (ไม่จำว่าเคยเห็นแล้ว — ตามที่ตกลง) เฉพาะ USER เท่านั้น
// (ADMIN มีหน้า /admin/announcements จัดการเห็นครบอยู่แล้ว ไม่ต้องเด้งซ้ำ)
// อ่าน flag แค่ครั้งเดียวตอน mount (lazy useState initializer) แล้ว clear ทันที กัน SPA navigate
// ไปมาในหน้าเดิมแล้วเด้งซ้ำ — flag นี้อยู่แค่ใน memory ของ query client เลยหายเองตอน reload หน้า
// (reload = ไม่ใช่ login event ใหม่ ไม่ควรเด้ง)
//
// popup แสดงแค่รูปภาพล้วน ๆ — ไม่มี title/badge/ข้อความ/ลิงก์ (ต่างจาก dashboard board ที่มี caption)
// ไม่ใช้ <Modal> เพราะ Modal มี header bar + padding ที่บังคับให้เห็นเสมอ ที่นี่อยากได้ภาพเต็ม ๆ
// ไม่มีกรอบ header คั่น เลยประกอบ overlay เองแบบเรียบง่าย (ปุ่มปิดลอยทับมุมภาพแทน)
export function AnnouncementPopup() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [shouldCheck] = useState(
    () => user?.role === 'USER' && qc.getQueryData<boolean>(ANNOUNCEMENT_POPUP_PENDING_KEY) === true,
  )
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (shouldCheck) qc.setQueryData(ANNOUNCEMENT_POPUP_PENDING_KEY, false)
  }, [shouldCheck, qc])

  // enabled ค้างเป็น true ตลอดหลัง mount ครั้งแรก (shouldCheck ไม่เปลี่ยนกลับ) — ถ้าไม่ปิด
  // refetch อัตโนมัติ (window focus/reconnect/remount) query นี้จะยิงซ้ำทุกครั้งที่ user สลับกลับมาที่แท็บ
  // แล้วถ้า admin เพิ่ง publish ประกาศใหม่พอดี popup จะเด้งซ้ำทั้งที่ไม่ได้ login ใหม่ — ต้อง fetch แค่ครั้งเดียวจริง ๆ
  const { data: announcement } = useQuery({
    queryKey: ['announcements', 'latest'],
    queryFn: getLatestAnnouncement,
    enabled: shouldCheck,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  useEffect(() => {
    if (announcement?.fileSignedUrl != null) setOpen(true)
  }, [announcement])

  const mounted = useDelayedUnmount(open, 150)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  if (!mounted || announcement?.fileSignedUrl == null) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={[
          'absolute inset-0 bg-black/40 backdrop-blur-sm',
          open ? 'animate-backdrop-in' : 'animate-backdrop-out',
        ].join(' ')}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className={[
          'relative w-[90vw] max-w-5xl overflow-hidden rounded-lg shadow-xl',
          open ? 'animate-modal-in' : 'animate-modal-out',
        ].join(' ')}
        role="dialog"
        aria-modal="true"
      >
        <button
          onClick={() => setOpen(false)}
          aria-label={t('common.close')}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
        >
          <X size={16} />
        </button>
        {announcement.link != null ? (
          <a href={announcement.link} target="_blank" rel="noreferrer">
            <img
              src={announcement.fileSignedUrl}
              alt=""
              className="max-h-[80vh] w-full cursor-pointer object-contain"
            />
          </a>
        ) : (
          <img src={announcement.fileSignedUrl} alt="" className="max-h-[80vh] w-full object-contain" />
        )}
      </div>
    </div>,
    document.body,
  )
}
