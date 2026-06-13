import './loadEnv'
import { app } from './app'
import { bootstrapDatabase } from './db/migrate'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'

async function main() {
  await bootstrapDatabase()
  app.listen(PORT, HOST, () => {
    console.log(`[server] http://${HOST}:${PORT}`)
  })
}

main().catch((error) => {
  console.error('[server] failed to start', error)
  process.exit(1)
})
