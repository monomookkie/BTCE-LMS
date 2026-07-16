export function formatDate(iso: string | Date, locale: string = 'en'): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = locale === 'th' ? date.getFullYear() + 543 : date.getFullYear()
  return `${day}/${month}/${year}`
}
