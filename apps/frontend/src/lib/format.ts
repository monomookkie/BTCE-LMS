export function formatDate(iso: string | Date, locale: string = 'en'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = locale === 'th' ? date.getFullYear() + 543 : date.getFullYear()
  return `${day}/${month}/${year}`
}

export function formatRelativeDate(iso: string | Date, locale: string = 'en'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (diffDays === 0) return locale === 'th' ? 'วันนี้' : 'Today'
  if (diffDays === 1) return locale === 'th' ? 'เมื่อวาน' : 'Yesterday'
  if (diffDays < 7) return locale === 'th' ? `${diffDays} วันที่แล้ว` : `${diffDays} days ago`
  return formatDate(date, locale)
}

export function formatNumber(n: number, locale: string = 'en'): string {
  return n.toLocaleString(locale === 'th' ? 'th-TH' : 'en-US')
}
