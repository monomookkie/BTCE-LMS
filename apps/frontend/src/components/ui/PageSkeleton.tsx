import { Skeleton } from './Skeleton.js'
import { StatCardSkeleton } from './StatCard.js'
import { Card } from './Card.js'

type PageSkeletonVariant = 'app' | 'content' | 'auth' | 'dashboard' | 'courses' | 'table'

interface PageSkeletonProps {
  variant?: PageSkeletonVariant
}

// ชั้นหยาบ — ใช้เป็น Suspense fallback ก่อน lazy chunk ของหน้าจะโหลดเสร็จ (ยังไม่รู้ข้อมูลจริง)
// แต่ละ variant ประมาณโครง layout ของกลุ่มหน้านั้นให้ใกล้เคียงกับ skeleton ละเอียดที่หน้านั้นแสดงเองหลัง mount
// เพื่อไม่ให้เห็นการกระพริบ 2 จังหวะตอน transition จาก route-level เข้าสู่ per-page skeleton
export function PageSkeleton({ variant = 'content' }: PageSkeletonProps) {
  if (variant === 'app') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
    )
  }

  if (variant === 'auth') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
          <div className="space-y-3 px-8 py-6">
            <Skeleton className="h-5 w-40 bg-slate-300" />
            <Skeleton className="h-3.5 w-56 bg-slate-300" />
          </div>
          <div className="space-y-4 px-8 py-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="space-y-3 border-t border-slate-100 pt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between gap-4">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'dashboard') {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="mb-4 h-4 w-32" />
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'courses') {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="flex flex-col">
              <div className="mb-3 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
              <div className="mt-auto space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="mt-3 h-7 w-24 rounded-full" />
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-full max-w-sm rounded-xl" />
        <div className="overflow-hidden rounded-md border border-slate-100">
          <div className="flex gap-4 bg-slate-50 px-3 py-2.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/6" />
            <Skeleton className="h-3 w-1/6" />
            <Skeleton className="h-3 w-1/6" />
            <Skeleton className="h-3 w-1/12" />
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-3 py-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/6" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-1/6" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // 'content' — ค่าเริ่มต้นสำหรับหน้าที่เหลือ (ตาราง/รายละเอียด) ก่อนรู้โครงจริงของหน้านั้น
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-6 w-40" />
      <Card>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </Card>
    </div>
  )
}
