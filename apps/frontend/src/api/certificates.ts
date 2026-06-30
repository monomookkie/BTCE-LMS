import type { CertificatePublicResponse, ExternalCertResponse } from '@btec-lms/shared'
import { apiFetch, apiFetchBlob } from '../lib/api.js'

export interface CertsPage {
  data: CertificatePublicResponse[]
  total: number
  page: number
  limit: number
}

export function listMyCertificates(): Promise<CertsPage> {
  return apiFetch<CertsPage>('/certificates?page=1&limit=100')
}

export function listExternalCerts(): Promise<ExternalCertResponse[]> {
  return apiFetch<ExternalCertResponse[]>('/external-certs')
}

export async function downloadCertPdf(id: string, certNumber: string): Promise<void> {
  const blob = await apiFetchBlob(`/certificates/${id}/pdf`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${certNumber}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // defer revoke — browser needs the URL alive until download is initiated
  setTimeout(() => { URL.revokeObjectURL(url) }, 200)
}
