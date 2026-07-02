import type { CertificateVerifyResponse } from '@btec-lms/shared'
import { apiFetch } from '../lib/api.js'

export function getPublicCertificate(hash: string): Promise<CertificateVerifyResponse> {
  return apiFetch<CertificateVerifyResponse>(`/verify/${hash}`, { skipRefresh: true })
}
