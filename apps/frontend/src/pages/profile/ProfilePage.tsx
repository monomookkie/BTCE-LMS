import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { changePasswordInputSchema } from '@btec-lms/shared'
import { useAuth, AUTH_QUERY_KEY } from '../../hooks/useAuth.js'
import { patchProfile, changePassword } from '../../api/users.js'
import { ApiError } from '../../lib/api.js'
import { Card } from '../../components/ui/Card.js'
import { Input } from '../../components/ui/Input.js'
import { Button } from '../../components/ui/Button.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { LanguageSwitcher } from '../../components/LanguageSwitcher.js'
import { useToast } from '../../hooks/useToast.js'

// ─── Schema builders (module scope) — types derived via ReturnType so the
// schema construction itself only ever happens inside useMemo, not as an
// unused module-level side effect purely for type extraction. ────────────

type TFn = ReturnType<typeof useTranslation>['t']

function buildProfileSchema(t: TFn) {
  return z.object({
    name: z.string().min(1, t('common.required')).max(100),
    position: z.string().max(100).optional(),
  })
}

function buildPasswordSchema(t: TFn) {
  return changePasswordInputSchema
    .extend({
      // backend policy: min 8, max 72 — match exactly, no extra complexity rules
      newPassword: z.string().min(8, t('profile.passwordMinLength', { count: 8 })).max(72),
      confirmPassword: z.string().min(1, t('common.required')),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: t('profile.passwordMismatch'),
      path: ['confirmPassword'],
    })
}

type ProfileFormValues = z.infer<ReturnType<typeof buildProfileSchema>>
type PasswordFormValues = z.infer<ReturnType<typeof buildPasswordSchema>>

// mirror ของ ProfilePage จริง — 3 Card section: Personal Info (3 input rows), Language Pref (1 row), Change Password (3 rows)
function ProfilePageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Skeleton className="h-5 w-32" />
      <Card header={<Skeleton className="h-3.5 w-28" />}>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </Card>
      <Card header={<Skeleton className="h-3.5 w-32" />}>
        <Skeleton className="h-9 w-40 rounded-lg" />
      </Card>
      <Card header={<Skeleton className="h-3.5 w-28" />}>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  // Schemas rebuilt when language changes so error messages are always localised
  const profileSchema = useMemo(() => buildProfileSchema(t), [t])
  const passwordSchema = useMemo(() => buildPasswordSchema(t), [t])

  // ─── Profile form ──────────────────────────────────────────────────

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name ?? '',
      position: user?.position ?? '',
    },
  })

  const onSaveProfile = async (data: ProfileFormValues) => {
    try {
      const updated = await patchProfile({
        name: data.name,
        ...(data.position !== undefined ? { position: data.position } : {}),
      })
      // sync cache so Sidebar name updates immediately without refetch
      qc.setQueryData(AUTH_QUERY_KEY, (prev: typeof user) =>
        prev ? { ...prev, ...updated } : prev,
      )
      toast.success(t('profile.saved'))
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      profileForm.setError('root', { message })
    }
  }

  // ─── Password form ─────────────────────────────────────────────────

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
  })

  const onChangePassword = async (data: PasswordFormValues) => {
    try {
      await changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      })
      // backend cleared cookies + revoked all refresh tokens
      qc.clear()
      navigate('/login', { replace: true })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('common.error')
      passwordForm.setError('root', { message })
    }
  }

  if (!user) return <ProfilePageSkeleton />

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold text-slate-800">{t('profile.title')}</h1>

      {/* ── Personal Information ── */}
      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">{t('profile.info')}</h2>
        }
      >
        <form
          onSubmit={profileForm.handleSubmit(onSaveProfile)}
          noValidate
          className="space-y-4"
        >
          <Input
            label={t('profile.emailReadOnly')}
            value={user?.email ?? ''}
            readOnly
            disabled
          />
          <Input
            label={t('user.name')}
            error={profileForm.formState.errors.name?.message}
            {...profileForm.register('name')}
          />
          <Input
            label={t('profile.position')}
            error={profileForm.formState.errors.position?.message}
            {...profileForm.register('position')}
          />

          {profileForm.formState.errors.root && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {profileForm.formState.errors.root.message}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" isLoading={profileForm.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>

      {/* ── Language Preference — uses same useLanguage hook as TopBar ── */}
      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">{t('profile.languagePref')}</h2>
        }
      >
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">{t('common.language')}</span>
          <LanguageSwitcher isAuthenticated />
        </div>
      </Card>

      {/* ── Change Password ── */}
      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">{t('profile.passwordSection')}</h2>
        }
      >
        <form
          onSubmit={passwordForm.handleSubmit(onChangePassword)}
          noValidate
          className="space-y-4"
        >
          <Input
            type="password"
            autoComplete="current-password"
            label={t('auth.currentPassword')}
            error={passwordForm.formState.errors.currentPassword?.message}
            {...passwordForm.register('currentPassword')}
          />
          <Input
            type="password"
            autoComplete="new-password"
            label={t('auth.newPassword')}
            error={passwordForm.formState.errors.newPassword?.message}
            {...passwordForm.register('newPassword')}
          />
          <Input
            type="password"
            autoComplete="new-password"
            label={t('auth.confirmPassword')}
            error={passwordForm.formState.errors.confirmPassword?.message}
            {...passwordForm.register('confirmPassword')}
          />

          {passwordForm.formState.errors.root && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {passwordForm.formState.errors.root.message}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="danger"
              isLoading={passwordForm.formState.isSubmitting}
            >
              {t('user.changePassword')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
