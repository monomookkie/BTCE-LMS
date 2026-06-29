import { Resend } from 'resend'
import { env } from '../config/env.js'
import { logger } from './logger.js'

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SendMailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

export interface MailerProvider {
  sendMail(opts: SendMailOptions): Promise<void>
}

// ─── FakeMailer — ใช้ใน NODE_ENV=test หรือไม่มี RESEND_API_KEY ──────────────
// ไม่ยิง network จริง — log เท่านั้น

class FakeMailer implements MailerProvider {
  async sendMail(opts: SendMailOptions): Promise<void> {
    logger.info({ to: opts.to, subject: opts.subject }, '[FakeMailer] email suppressed (test/no-key)')
  }
}

// ─── ResendMailer — production ────────────────────────────────────────────────

class ResendMailer implements MailerProvider {
  private client: Resend
  private from: string

  constructor(apiKey: string) {
    this.client = new Resend(apiKey)
    this.from = 'BTEC LMS <noreply@btec-lms.org>'
  }

  async sendMail(opts: SendMailOptions): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      ...(opts.html && { html: opts.html }),
    })

    if (error) throw new Error(`Resend error: ${error.message}`)
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _mailer: MailerProvider | null = null

export function getMailer(): MailerProvider {
  if (!_mailer) {
    const useReal = env.NODE_ENV !== 'test' && !!env.RESEND_API_KEY
    _mailer = useReal ? new ResendMailer(env.RESEND_API_KEY!) : new FakeMailer()
  }
  return _mailer
}

