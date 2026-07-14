import { useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Navigate, Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { z } from 'zod'
import { registerInputSchema, isAllowedRegisterEmailDomain } from '@btec-lms/shared'
import { listPositions } from '../../api/positions.js'
import { recordConsent } from '../../api/users.js'
import { useAuth, useRegisterMutation, ApiError } from '../../hooks/useAuth.js'
import { LOGO_URL } from '../../lib/branding.js'
import { PDPA_POLICY_VERSION } from '../../lib/consent.js'
import { Input } from '../../components/ui/Input.js'
import { Button } from '../../components/ui/Button.js'
import { Select } from '../../components/ui/Select.js'
import { PageSkeleton } from '../../components/ui/PageSkeleton.js'
import { PasswordStrengthMeter } from '../../components/auth/PasswordStrengthMeter.js'

type TFn = ReturnType<typeof useTranslation>['t']

// sentinel เฉพาะ UI — เลือกแล้วส่ง positionId: null จริงไปหา backend (2C-5)
const OTHER_POSITION = '__other__'

// confirmPassword ตรวจแค่ฝั่ง client — schema จริงที่ส่งไป backend คือ registerInputSchema
// เดิม (ไม่มี confirmPassword) ผ่าน .extend() นี่คือ superset ไม่ใช่ schema คนละตัว
function buildRegisterFormSchema(t: TFn) {
  return registerInputSchema
    .omit({ positionId: true })
    .extend({
      // override email/password ทับของเดิมจาก shared schema — shared ใช้ raw English message
      // เพราะ backend เข้าไม่ถึง react-i18next ได้ (ดู packages/shared/src/schemas/auth.schema.ts)
      // ฝั่ง frontend เลยแทนที่ด้วยเวอร์ชัน t()-translated ตรงนี้แทน ไม่แตะ shared/backend
      email: z.string().email().refine(isAllowedRegisterEmailDomain, {
        message: t('auth.emailDomainNotAllowed'),
      }),
      password: z
        .string()
        .min(8, t('profile.passwordMinLength', { count: 8 }))
        .max(72)
        .regex(/[a-z]/, t('auth.passwordLowercase'))
        .regex(/[A-Z]/, t('auth.passwordUppercase'))
        .regex(/[0-9]/, t('auth.passwordNumber'))
        .regex(/[^A-Za-z0-9]/, t('auth.passwordSpecialChar')),
      confirmPassword: z.string().min(1, t('common.required')),
      positionChoice: z.string().min(1, t('common.required')),
      positionOther: z.string().trim().max(100).optional(),
      pdpaConsent: z.boolean().refine((v) => v, { message: t('common.required') }),
    })
    .superRefine((d, ctx) => {
      if (d.positionChoice === OTHER_POSITION && !d.positionOther?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('common.required'),
          path: ['positionOther'],
        })
      }
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t('profile.passwordMismatch'),
      path: ['confirmPassword'],
    })
}

type RegisterFormValues = z.infer<ReturnType<typeof buildRegisterFormSchema>>

export default function RegisterPage() {
  const { t, i18n } = useTranslation()
  const { user, isLoading } = useAuth()
  const registerMutation = useRegisterMutation()

  // ต่อ locale เข้า queryKey — response เป็น localized field (name) ต้อง refetch เมื่อสลับภาษา
  // ไม่งั้น cache ค้างภาษาเดิมจนกว่าจะ reload หน้า
  const { data: positions } = useQuery({
    queryKey: ['positions', i18n.language],
    queryFn: listPositions,
  })

  const registerFormSchema = useMemo(() => buildRegisterFormSchema(t), [t])

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
  })

  const passwordValue = watch('password') ?? ''
  const confirmPasswordValue = watch('confirmPassword') ?? ''
  const positionChoiceValue = watch('positionChoice') ?? ''
  const isOtherPosition = positionChoiceValue === OTHER_POSITION
  const showMatchIndicator = confirmPasswordValue.length > 0

  if (!isLoading && user) {
    const dest = user.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'
    return <Navigate to={dest} replace />
  }

  if (isLoading) return <PageSkeleton variant="auth" />

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      await registerMutation.mutateAsync({
        name: data.name,
        email: data.email,
        department: data.department,
        password: data.password,
        ...(data.employeeId ? { employeeId: data.employeeId } : {}),
        // "Others" (isOtherPosition) → positionId: null เสมอ ไม่ว่าจะกรอก positionOther หรือไม่
        // (2C-5: backend เก็บแค่ positionId จริง — free-text "อื่นๆ" ไม่มีที่เก็บฝั่ง server)
        positionId: isOtherPosition ? null : positionChoiceValue,
      })
      // บันทึก PDPA consent แยกเป็น request ที่สอง — /auth/register ไม่มี field consent ในตัว
      // (POST /users/me/consent ต้อง login ก่อน แต่ตอนนี้ cookie ตั้งแล้วจาก auto-login ของ register)
      // ไม่บล็อก UX ถ้า fail — user สมัครสำเร็จแล้ว ไม่ควรเห็น error ทั้งที่บัญชีสร้างเสร็จจริง
      void recordConsent({ type: 'PDPA_BASIC', granted: true, version: PDPA_POLICY_VERSION }).catch(() => {})
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      setError('root', { message })
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)' }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Card header — navy gradient */}
        <div
          className="flex flex-col items-center px-8 py-6 text-center text-white"
          style={{ background: 'linear-gradient(135deg,#0D1B2A,#1A3A5C)' }}
        >
          <img src={LOGO_URL} alt={t('app.name')} className="mb-3 h-14 w-14 rounded-xl object-contain" />
          <h1 className="text-lg font-bold">{t('auth.registerTitle')}</h1>
          <p className="mt-1 text-sm text-white/70">{t('auth.registerSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-8 py-6">
          <Input
            label={t('user.name')}
            placeholder={t('auth.namePlaceholder')}
            error={errors.name?.message}
            {...register('name')}
          />

          <Input
            type="email"
            autoComplete="email"
            label={t('auth.email')}
            placeholder={t('auth.emailPlaceholder')}
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            label={t('auth.department')}
            placeholder={t('auth.departmentPlaceholder')}
            error={errors.department?.message}
            {...register('department')}
          />

          <Controller
            name="positionChoice"
            control={control}
            defaultValue=""
            render={({ field }) => (
              <Select
                id="position"
                label={t('auth.jobPosition')}
                placeholder={t('auth.positionSelectPlaceholder')}
                value={field.value ?? ''}
                onChange={field.onChange}
                error={errors.positionChoice?.message}
                options={[
                  ...(positions ?? []).map((p) => ({ value: p.id, label: p.name })),
                  { value: OTHER_POSITION, label: t('auth.positionOther') },
                ]}
              />
            )}
          />

          {isOtherPosition && (
            <Input
              label={t('auth.positionOther')}
              placeholder={t('auth.positionOtherPlaceholder')}
              error={errors.positionOther?.message}
              {...register('positionOther')}
            />
          )}

          <Input
            type="password"
            autoComplete="new-password"
            label={t('auth.password')}
            placeholder="••••••••"
            helperText={t('auth.passwordRequirements')}
            error={errors.password?.message}
            {...register('password')}
          />

          <PasswordStrengthMeter password={passwordValue} />

          <Input
            type="password"
            autoComplete="new-password"
            label={t('auth.confirmPassword')}
            placeholder="••••••••"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          {showMatchIndicator && !errors.confirmPassword && (
            <p
              className={`-mt-2 flex items-center gap-1 text-xs ${
                passwordValue === confirmPasswordValue ? 'text-emerald-600' : 'text-danger'
              }`}
            >
              {passwordValue === confirmPasswordValue ? <Check size={13} /> : <X size={13} />}
              {passwordValue === confirmPasswordValue
                ? t('profile.passwordsMatch')
                : t('profile.passwordMismatch')}
            </p>
          )}

          <div>
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                {...register('pdpaConsent')}
              />
              <span>
                {t('auth.pdpaConsentPrefix')}{' '}
                <Link
                  to="/privacy-policy"
                  target="_blank"
                  className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
                >
                  {t('auth.privacyPolicyLink')}
                </Link>
              </span>
            </label>
            {errors.pdpaConsent && (
              <p className="mt-1 text-xs text-danger">{errors.pdpaConsent.message}</p>
            )}
          </div>

          {errors.root && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          )}

          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            {isSubmitting ? t('auth.registering') : t('auth.registerLink')}
          </Button>

          <p className="text-center text-xs text-slate-500">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              {t('auth.loginLink')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
