interface SkeletonProps {
  className?: string | undefined
}

// atom เดียวเล็กสุด — รูปทรง (bar/pill/circle) กำหนดผ่าน className ล้วนๆ (rounded-full+h=w สำหรับ circle,
// rounded-full+เตี้ยสำหรับ pill, rounded ปกติสำหรับ bar) ไฟล์อื่นประกอบร่างเฉพาะหน้าจาก atom นี้
export function Skeleton({ className }: SkeletonProps) {
  return <div className={['animate-pulse rounded bg-slate-200', className ?? 'h-4 w-full'].join(' ')} />
}
