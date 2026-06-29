interface SkeletonProps {
  className?: string | undefined
  lines?: number | undefined
}

function SkeletonLine({ className }: { className?: string | undefined }) {
  return (
    <div
      className={['animate-pulse rounded bg-slate-200', className ?? 'h-4 w-full'].join(' ')}
    />
  )
}

export function Skeleton({ className, lines }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} className={i === lines - 1 ? 'h-4 w-2/3' : 'h-4 w-full'} />
        ))}
      </div>
    )
  }
  return <SkeletonLine className={className} />
}
