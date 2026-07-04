import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import i18next from '../i18n/index.js'
import { login, register, logout, me, type LoginInput, type MeResponse } from '../api/auth.js'
import type { RegisterInput } from '@btec-lms/shared'
import { ApiError } from '../lib/api.js'

export const AUTH_QUERY_KEY = ['auth', 'me'] as const

export function useAuth() {
  const query = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: me,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnMount: false,      // user/session ไม่เปลี่ยนระหว่าง SPA navigation
    refetchOnWindowFocus: false,
  })

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isAuthenticated: query.isSuccess && !!query.data,
  }
}

export function useLoginMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (body: LoginInput) => login(body),
    onSuccess: (user: MeResponse) => {
      // sync i18n ก่อน setQueryData — ให้ UI เปลี่ยนภาษาก่อน redirect
      void i18next.changeLanguage(user.language)
      // setQueryData triggers re-render ของ LoginPage → <Navigate> จัดการ redirect เอง
      // ไม่ใช้ navigate() ตรงนี้เพราะจะ race กับ React render cycle (RequireAuth อาจเห็น user=null ชั่วคราว)
      qc.setQueryData(AUTH_QUERY_KEY, user)
    },
  })
}

export function useRegisterMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (body: RegisterInput) => register(body),
    onSuccess: (user: MeResponse) => {
      // auto-login pattern เดียวกับ useLoginMutation — server ออก cookie มาแล้ว
      void i18next.changeLanguage(user.language)
      qc.setQueryData(AUTH_QUERY_KEY, user)
    },
  })
}

export function useLogoutMutation() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      // clear cache ไม่ว่า logout BE จะสำเร็จหรือเปล่า
      qc.clear()
      navigate('/login', { replace: true })
    },
  })
}

export { ApiError }
