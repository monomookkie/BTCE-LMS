import type { CertificateAdminResponse, ExternalCertResponse, CertStatus } from '@btec-lms/shared'
import { apiFetch, apiFetchBlob } from '../lib/api.js'

export interface AdminCertListParams {
  status?: CertStatus
  courseId?: string
  search?: string
  page?: number
  limit?: number
}

export interface AdminCertListResponse {
  data: CertificateAdminResponse[]
  total: number
  page: number
  limit: number
}

function buildCertQs(params: AdminCertListParams): string {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.courseId) qs.set('courseId', params.courseId)
  if (params.search) qs.set('search', params.search)
  if (params.page != null) qs.set('page', String(params.page))
  qs.set('limit', String(params.limit ?? 20))
  return qs.toString()
}

export function listAdminCertificates(params: AdminCertListParams = {}): Promise<AdminCertListResponse> {
  return apiFetch<AdminCertListResponse>(`/certificates?${buildCertQs(params)}`)
}

export function getAdminCertificate(id: string): Promise<CertificateAdminResponse> {
  return apiFetch<CertificateAdminResponse>(`/certificates/${id}`)
}

export function downloadCertPdf(id: string, certNumber: string): Promise<void> {
  return apiFetchBlob(`/certificates/${id}/pdf`).then((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `certificate-${certNumber}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => { URL.revokeObjectURL(url) }, 200)
  })
}

export function revokeCertificate(id: string, reason?: string): Promise<CertificateAdminResponse> {
  return apiFetch<CertificateAdminResponse>(`/certificates/${id}/revoke`, {
    method: 'POST',
    json: { ...(reason?.trim() ? { reason: reason.trim() } : {}) },
  })
}

export function listUserExternalCerts(userId: string): Promise<ExternalCertResponse[]> {
  return apiFetch<ExternalCertResponse[]>(`/external-certs?userId=${userId}`)
}
