interface AvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg' | undefined
  className?: string | undefined
}

const sizeClasses = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <div
      aria-label={name}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full bg-navy-800 font-semibold text-white',
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {getInitials(name)}
    </div>
  )
}
