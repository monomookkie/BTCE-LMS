import { useTranslation } from 'react-i18next'

interface PasswordStrengthMeterProps {
  password: string
}

// เกณฑ์เดียวกับ registerPasswordSchema (packages/shared/src/schemas/auth.schema.ts)
// นับจำนวนเกณฑ์ที่ผ่าน — ไม่ import schema ตรงมาเพราะแค่ต้องการนับ ไม่ต้อง validate/throw
function scorePassword(password: string): number {
  const checks = [
    password.length >= 8,
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  return checks.filter(Boolean).length
}

const LEVELS = [
  { max: 1, color: 'bg-red-500',    labelKey: 'auth.strength.weak' },
  { max: 3, color: 'bg-amber-500',  labelKey: 'auth.strength.fair' },
  { max: 4, color: 'bg-blue-500',   labelKey: 'auth.strength.good' },
  { max: 5, color: 'bg-emerald-500', labelKey: 'auth.strength.strong' },
] as const

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const { t } = useTranslation()
  if (!password) return null

  const score = scorePassword(password)
  const level = LEVELS.find((l) => score <= l.max) ?? LEVELS[LEVELS.length - 1]!
  const pct = (score / 5) * 100

  return (
    <div className="-mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-300 ${level.color}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={5}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">{t(level.labelKey)}</p>
    </div>
  )
}
