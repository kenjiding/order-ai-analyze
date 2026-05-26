import './loadEnv'
import { app } from './app'

const PORT = Number(process.env.PORT ?? 8787)

app.listen(PORT, () => {
  console.log(`[server] http://127.0.0.1:${PORT}`)
})
