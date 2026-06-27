import { buildApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'

async function start() {
  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (err) {
    logger.error(err)
    process.exit(1)
  }
}

start()
