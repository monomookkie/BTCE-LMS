import i18next from '../i18n/index.js'

// In dev the Vite proxy rewrites /api/* → http://localhost:3000/*
// In prod set VITE_API_URL=https://your-backend.railway.app
const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/api'

interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown
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

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { json, headers: extra, ...rest } = options

  const headers = new Headers(extra as HeadersInit | undefined)
  // แนบ Accept-Language ทุก request เพื่อให้ backend resolveLocale ทำงานได้
  headers.set('Accept-Language', i18next.language)
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers,
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(
      res.status,
      (data as { message?: string }).message ?? res.statusText,
      data,
    )
  }

  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
