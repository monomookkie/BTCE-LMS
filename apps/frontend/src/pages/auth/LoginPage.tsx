import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Navigate, Link } from 'react-router-dom'
import { loginInputSchema, type LoginInput } from '@btec-lms/shared'
import { useAuth, useLoginMutation, ApiError } from '../../hooks/useAuth.js'
import { LOGO_URL } from '../../lib/branding.js'
import { Input } from '../../components/ui/Input.js'
import { Button } from '../../components/ui/Button.js'
import { PageSkeleton } from '../../components/ui/PageSkeleton.js'
import { LanguageSwitcher } from '../../components/LanguageSwitcher.js'

export default function LoginPage() {
  const { t } = useTranslation()
  const { user, isLoading } = useAuth()
  const loginMutation = useLoginMutation()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
  })

  if (!isLoading && user) {
    const dest = user.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'
    return <Navigate to={dest} replace />
  }

  if (isLoading) return <PageSkeleton variant="auth" />

  const onSubmit = async (data: LoginInput) => {
    try {
      await loginMutation.mutateAsync(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      setError('root', { message })
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center"
      style={{ background: 'linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)' }}
    >
      <div
        className="absolute"
        style={{ top: 'max(1rem, env(safe-area-inset-top))', right: 'max(1rem, env(safe-area-inset-right))' }}
      >
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Card header — navy gradient */}
        <div
          className="flex flex-col items-center px-8 py-6 text-center text-white"
          style={{ background: 'linear-gradient(135deg,#0D1B2A,#1A3A5C)' }}
        >
          <img src={LOGO_URL} alt={t('app.name')} className="mb-3 h-14 w-14 rounded-xl object-contain" />
          <h1 className="text-lg font-bold">{t('auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-white/70">{t('auth.loginSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-8 py-6">
          <Input
            type="email"
            autoComplete="email"
            label={t('auth.email')}
            placeholder={t('auth.emailPlaceholder')}
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            type="password"
            autoComplete="current-password"
            label={t('auth.password')}
            placeholder="••••••••"
            error={errors.password?.message}
            {...register('password')}
          />

          {errors.root && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {errors.root.message}
            </p>
          )}

          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
          </Button>

          <p className="text-center text-xs text-slate-500">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="font-medium text-brand-600 hover:underline">
              {t('auth.registerLink')}
            </Link>
          </p>

          <p className="text-center text-xs text-slate-500">{t('auth.forgotPasswordHint')}</p>
        </form>
      </div>
    </div>
  )
}
