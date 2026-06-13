import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { requireAuth } from './auth/middleware'
import { pingDatabase } from './db'
import { adminUsersRouter } from './routes/adminUsersRouter'
import { authRouter } from './routes/authRouter'
import { feishuWebhookTestRouter } from './routes/feishuWebhookTestRouter'
import { orderExceptionRouter } from './routes/orderExceptionRouter'
import { scannerEfficiencyRouter } from './routes/scannerEfficiencyRouter'
import { weeklyReportInsightRouter } from './routes/weeklyReportInsightRouter'
import { jobsRouter } from './routes/jobsRouter'

const app = express()

function getCorsOrigin(): string | string[] | boolean {
  const raw = String(process.env.CORS_ORIGIN ?? '').trim()
  if (raw) {
    return raw.split(',').map((item) => item.trim()).filter(Boolean)
  }
  if (process.env.NODE_ENV !== 'production') {
    return ['http://127.0.0.1:5173', 'http://localhost:5173']
  }
  return true
}

/** 飞书推送图等为 data URL / Base64，单请求易超过默认 100kb；须覆盖大图场景（与 push-image 校验上限一致） */
app.use(
  cors({
    origin: getCorsOrigin(),
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json({ limit: '12mb' }))

app.get('/health', async (_req, res) => {
  const dbOk = await pingDatabase().catch(() => false)
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk ? 'up' : 'down' })
})

app.use('/api/auth', authRouter)
app.use('/api/admin/users', adminUsersRouter)

app.use('/api/order-exception', requireAuth, orderExceptionRouter)
app.use('/api/scanner-efficiency', requireAuth, scannerEfficiencyRouter)
app.use('/api/weekly-report-insight', requireAuth, weeklyReportInsightRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/feishu-webhook', requireAuth, feishuWebhookTestRouter)

export { app }
