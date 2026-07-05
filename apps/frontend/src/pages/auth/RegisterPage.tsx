import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Navigate, Link } from 'react-router-dom'
import { Droplets } from 'lucide-react'
import { z } from 'zod'
import { registerInputSchema } from '@btec-lms/shared'
import { useAuth, useRegisterMutation, ApiError } from '../../hooks/useAuth.js'
import { Input } from '../../components/ui/Input.js'
import { Button } from '../../components/ui/Button.js'
import { PageSkeleton } from '../../components/ui/PageSkeleton.js'

type TFn = ReturnType<typeof useTranslation>['t']

// confirmPassword ตรวจแค่ฝั่ง client — schema จริงที่ส่งไป backend คือ registerInputSchema
// เดิม (ไม่มี confirmPassword) ผ่าน .extend() นี่คือ superset ไม่ใช่ schema คนละตัว
function buildRegisterFormSchema(t: TFn) {
  return registerInputSchema
    .extend({
      confirmPassword: z.string().min(1, t('common.required')),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t('profile.passwordMismatch'),
      path: ['confirmPassword'],
    })
}

type RegisterFormValues = z.infer<ReturnType<typeof buildRegisterFormSchema>>

export default function RegisterPage() {
  const { t } = useTranslation()
  const { user, isLoading } = useAuth()
  const registerMutation = useRegisterMutation()

  const registerFormSchema = useMemo(() => buildRegisterFormSchema(t), [t])

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
  })

  if (!isLoading && user) {
    const dest = user.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'
    return <Navigate to={dest} replace />
  }

  if (isLoading) return <PageSkeleton variant="auth" />

  const onSubmit = async (data: RegisterFormValues) => {
    try {
      const { confirmPassword: _confirmPassword, ...body } = data
      await registerMutation.mutateAsync(body)
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
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-white">
            <Droplets size={28} className="text-danger" />
          </div>
          <h1 className="text-lg font-bold">{t('auth.registerTitle')}</h1>
          <p className="mt-1 text-sm text-white/70">{t('auth.registerSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-8 py-6">
          <Input
            label={t('user.name')}
            error={errors.name?.message}
            {...register('name')}
          />

          <Input
            type="email"
            autoComplete="email"
            label={t('auth.email')}
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            type="password"
            autoComplete="new-password"
            label={t('auth.password')}
            error={errors.password?.message}
            {...register('password')}
          />

          <Input
            type="password"
            autoComplete="new-password"
            label={t('auth.confirmPassword')}
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

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
