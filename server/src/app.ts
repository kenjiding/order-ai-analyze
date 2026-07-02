import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { requireAuth } from './auth/middleware'
import { pingDatabase } from './db'
import { adminUsersRouter } from './routes/adminUsersRouter'
import { authRouter } from './routes/authRouter'
import { feishuWebhookTestRouter } from './routes/feishuWebhookTestRouter'
import { newMerchantRouter } from './routes/newMerchantRouter'
import { orderExceptionRouter } from './routes/orderExceptionRouter'
import { problemPackageAuditRouter } from './routes/problemPackageAuditRouter'
import { scannerEfficiencyRouter } from './routes/scannerEfficiencyRouter'
import { weeklyReportInsightRouter } from './routes/weeklyReportInsightRouter'
import { efficiencyInsightRouter } from './routes/efficiencyInsightRouter'
import { jobsRouter } from './routes/jobsRouter'
import { vendorAnalysisRouter } from './routes/vendorAnalysisRouter'
import { vendorPortalRouter } from './routes/vendorPortalRouter'
import { fleetSupplierPushRouter } from './routes/fleetSupplierPushRouter'
import { exitAlarmRouter } from './routes/exitAlarmRouter'
import { supplierConfigScopeRouter } from './routes/supplierConfigScopeRouter'

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
app.use(express.json({ limit: '50mb' }))

app.get('/health', async (_req, res) => {
  const dbOk = await pingDatabase().catch(() => false)
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk ? 'up' : 'down' })
})

app.use('/api/auth', authRouter)
app.use('/api/admin/users', adminUsersRouter)

app.use('/api/order-exception', requireAuth, orderExceptionRouter)
app.use('/api/scanner-efficiency', requireAuth, scannerEfficiencyRouter)
app.use('/api/new-merchant', requireAuth, newMerchantRouter)
app.use('/api/weekly-report-insight', requireAuth, weeklyReportInsightRouter)
app.use('/api/efficiency-insight', requireAuth, efficiencyInsightRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/problem-audit', requireAuth, problemPackageAuditRouter)
app.use('/api/vendor-analysis', requireAuth, vendorAnalysisRouter)
// 供应商日报外部门户：凭分享 token 访问，不走登录鉴权
app.use('/api/vendor-portal', vendorPortalRouter)
app.use('/api/fleet-supplier-push', requireAuth, fleetSupplierPushRouter)
app.use('/api/supplier-config-scopes', requireAuth, supplierConfigScopeRouter)
app.use('/api/feishu-webhook', requireAuth, feishuWebhookTestRouter)
app.use('/api/exit-alarm', requireAuth, exitAlarmRouter)

export { app }
