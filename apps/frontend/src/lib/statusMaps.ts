import type { BadgeVariant } from '../components/ui/Badge.js'

export interface StatusConfig {
  variant: BadgeVariant
  i18nKey: string
}

const FALLBACK: StatusConfig = { variant: 'gray', i18nKey: 'status.unknown' }

const certMap: Record<string, StatusConfig> = {
  'valid':          { variant: 'green',  i18nKey: 'status.cert.valid' },
  'expiring-soon':  { variant: 'amber',  i18nKey: 'status.cert.expiringSoon' },
  'expired':        { variant: 'red',    i18nKey: 'status.cert.expired' },
  'revoked':        { variant: 'red',    i18nKey: 'status.cert.revoked' },
}

const enrollmentMap: Record<string, StatusConfig> = {
  'ASSIGNED':    { variant: 'gray',  i18nKey: 'status.enrollment.ASSIGNED' },
  'IN_PROGRESS': { variant: 'blue',  i18nKey: 'status.enrollment.IN_PROGRESS' },
  'COMPLETED':   { variant: 'green', i18nKey: 'status.enrollment.COMPLETED' },
  'EXPIRED':     { variant: 'red',   i18nKey: 'status.enrollment.EXPIRED' },
}

const announcementMap: Record<string, StatusConfig> = {
  'DRAFT':     { variant: 'gray',  i18nKey: 'status.announcement.DRAFT' },
  'PUBLISHED': { variant: 'green', i18nKey: 'status.announcement.PUBLISHED' },
}

const courseMap: Record<string, StatusConfig> = {
  'DRAFT':     { variant: 'gray',  i18nKey: 'course.status.DRAFT' },
  'PUBLISHED': { variant: 'green', i18nKey: 'course.status.PUBLISHED' },
  'ARCHIVED':  { variant: 'amber', i18nKey: 'course.status.ARCHIVED' },
}

const quizMap: Record<string, StatusConfig> = {
  'passed': { variant: 'green', i18nKey: 'status.quiz.passed' },
  'failed': { variant: 'red',   i18nKey: 'status.quiz.failed' },
}

const userMap: Record<string, StatusConfig> = {
  'active':    { variant: 'green', i18nKey: 'status.user.active' },
  'suspended': { variant: 'red',   i18nKey: 'status.user.suspended' },
}

export type StatusType = 'cert' | 'enrollment' | 'announcement' | 'course' | 'quiz' | 'user'

const maps: Record<StatusType, Record<string, StatusConfig>> = {
  cert:         certMap,
  enrollment:   enrollmentMap,
  announcement: announcementMap,
  course:       courseMap,
  quiz:         quizMap,
  user:         userMap,
}

export function getStatusConfig(type: StatusType, status: string): StatusConfig {
  return maps[type][status] ?? FALLBACK
}
