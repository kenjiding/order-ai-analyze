import './loadEnv'
import { app } from './app'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'

app.listen(PORT, HOST, () => {
  console.log(`[server] http://${HOST}:${PORT}`)
})
