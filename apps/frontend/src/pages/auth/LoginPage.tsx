import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { loginInputSchema, type LoginInput } from '@btec-lms/shared'
import { useAuth, useLoginMutation, ApiError } from '../../hooks/useAuth.js'
import { LanguageSwitcher } from '../../components/LanguageSwitcher.js'
import { Input } from '../../components/ui/Input.js'
import { Button } from '../../components/ui/Button.js'

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
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'linear-gradient(135deg,#061523,#0D1B2A,#1A3A5C,#1A56DB)' }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Card header — navy gradient */}
        <div
          className="px-8 py-6 text-white"
          style={{ background: 'linear-gradient(135deg,#0D1B2A,#1A3A5C)' }}
        >
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
          <h1 className="text-xl font-bold">{t('auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-white/70">{t('auth.loginSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-8 py-6">
          <Input
            type="email"
            autoComplete="email"
            label={t('auth.email')}
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            type="password"
            autoComplete="current-password"
            label={t('auth.password')}
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
        </form>
      </div>
    </div>
  )
}
