import { useTranslation } from 'react-i18next'
import { Badge } from './Badge.js'
import { getStatusConfig, type StatusType } from '../../lib/statusMaps.js'

interface StatusBadgeProps {
  type: StatusType
  status: string
  className?: string | undefined
}

export function StatusBadge({ type, status, className }: StatusBadgeProps) {
  const { t } = useTranslation()
  const { variant, i18nKey } = getStatusConfig(type, status)
  return (
    <Badge variant={variant} {...(className !== undefined ? { className } : {})}>
      {/* i18nKey is a runtime-dynamic string from statusMaps — 'as never' bypasses literal key check */}
      {t(i18nKey as never) as string}
    </Badge>
  )
}
