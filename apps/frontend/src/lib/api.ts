import i18next from '../i18n/index.js'
import { queryClient } from './queryClient.js'

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api'

interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
  /** true = ไม่ลอง refresh เมื่อ 401 (ใช้กับ login endpoint ซึ่ง 401 = ข้อมูลผิด ไม่ใช่ expired) */
  skipRefresh?: boolean
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function buildHeaders(extra?: HeadersInit, hasJson?: boolean): Headers {
  const headers = new Headers(extra as HeadersInit | undefined)
  headers.set('Accept-Language', i18next.language)
  if (hasJson) headers.set('Content-Type', 'application/json')
  return headers
}

async function doFetch(path: string, options: Omit<ApiOptions, 'skipRefresh'>): Promise<Response> {
  const { json, headers: extra, ...rest } = options
  return fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: buildHeaders(extra as HeadersInit | undefined, json !== undefined),
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  })
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  return (text ? (JSON.parse(text) as T) : undefined) as T
}

async function extractError(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => ({ message: res.statusText }))
  return new ApiError(
    res.status,
    (data as { message?: string }).message ?? res.statusText,
    data,
  )
}

function handleSessionExpiry(): void {
  // ถ้าอยู่ที่ /login อยู่แล้ว ไม่ต้อง redirect หรือ clear — ป้องกัน reload loop
  // (เกิดเมื่อ useAuth ยิง /auth/me บน login page แล้วไม่มี session)
  if (window.location.pathname.startsWith('/login')) return
  queryClient.clear()
  window.location.href = '/login'
}

// Singleton refresh promise — ป้องกัน concurrent refresh (สำคัญกับ rotation)
let refreshPromise: Promise<void> | null = null

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { skipRefresh, ...fetchOptions } = options
  let res = await doFetch(path, fetchOptions)

  if (res.status !== 401) {
    if (!res.ok) throw await extractError(res)
    return parseResponse<T>(res)
  }

  // skipRefresh: 401 หมายความว่า credential ผิด ไม่ใช่ token expired
  if (skipRefresh) throw await extractError(res)

  // ถ้า endpoint ที่ fail คือ refresh เอง → session ตายจริง ไม่ retry
  if (path === '/auth/refresh') {
    handleSessionExpiry()
    throw new ApiError(401, 'Session expired')
  }

  // ยิง refresh ครั้งเดียว — requests อื่นที่ 401 พร้อมกันรอ promise เดียวกัน
  if (!refreshPromise) {
    refreshPromise = doFetch('/auth/refresh', { method: 'POST' })
      .then((r) => {
        if (!r.ok) throw new ApiError(r.status, 'Token refresh failed')
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  try {
    await refreshPromise
  } catch {
    handleSessionExpiry()
    throw new ApiError(401, 'Session expired')
  }

  // Retry ครั้งเดียว
  res = await doFetch(path, options)
  if (!res.ok) {
    if (res.status === 401) handleSessionExpiry()
    throw await extractError(res)
  }

  return parseResponse<T>(res)
}
