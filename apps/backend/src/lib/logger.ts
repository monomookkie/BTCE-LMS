import pino from 'pino'
import { env } from '../config/env.js'

// exactOptionalPropertyTypes ไม่อนุญาตให้ transport เป็น undefined inline
// ใช้ conditional แยก options แทน
export const logger =
  env.NODE_ENV !== 'production'
    ? pino({
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      })
    : pino({ level: 'info' })
