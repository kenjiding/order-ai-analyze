import cors from 'cors'
import express from 'express'
import { feishuWebhookTestRouter } from './routes/feishuWebhookTestRouter'
import { orderExceptionRouter } from './routes/orderExceptionRouter'
import { weeklyReportInsightRouter } from './routes/weeklyReportInsightRouter'

const app = express()

/** 飞书推送图等为 data URL / Base64，单请求易超过默认 100kb；须覆盖大图场景（与 push-image 校验上限一致） */
app.use(cors())
app.use(express.json({ limit: '12mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/order-exception', orderExceptionRouter)
app.use('/api/weekly-report-insight', weeklyReportInsightRouter)
app.use('/api/feishu-webhook', feishuWebhookTestRouter)

export { app }
