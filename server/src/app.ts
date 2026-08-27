import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { requireAuth } from './auth/middleware'
import { pingDatabase } from './db'
import { imileHubcodeMiddleware } from './imile/hubcodeMiddleware'
import { adminUsersRouter } from './routes/adminUsersRouter'
import { authRouter } from './routes/authRouter'
import { feishuWebhookTestRouter } from './routes/feishuWebhookTestRouter'
import { feishuEventRouter } from './routes/feishuEventRouter'
import { newMerchantRouter } from './routes/newMerchantRouter'
import { orderExceptionRouter } from './routes/orderExceptionRouter'
import { problemPackageAuditRouter } from './routes/problemPackageAuditRouter'
import { scannerEfficiencyRouter } from './routes/scannerEfficiencyRouter'
import { weeklyReportInsightRouter } from './routes/weeklyReportInsightRouter'
import { efficiencyInsightRouter } from './routes/efficiencyInsightRouter'
import { jobsRouter } from './routes/jobsRouter'
import { vendorAnalysisRouter } from './routes/vendorAnalysisRouter'
import { vendorPortalRouter } from './routes/vendorPortalRouter'
import { vendorRegionMapRouter } from './routes/vendorRegionMapRouter'
import { chaseDispatchPortalRouter } from './routes/chaseDispatchPortalRouter'
import { fleetSupplierPushRouter } from './routes/fleetSupplierPushRouter'
import { exitAlarmRouter } from './routes/exitAlarmRouter'
import { chaseDispatchRouter } from './routes/chaseDispatchRouter'
import { workOrderPushRouter } from './routes/workOrderPushRouter'
import { dispatchAlarmRouter } from './routes/dispatchAlarmRouter'
import { dispatchAlarmPortalRouter } from './routes/dispatchAlarmPortalRouter'
import { deliveringNotifyRouter } from './routes/deliveringNotifyRouter'
import { returnToMerchantRouter } from './routes/returnToMerchantRouter'
import { attendanceWorkTimeRouter } from './routes/attendanceWorkTimeRouter'
import { containerManagementRouter } from './routes/containerManagementRouter'
import { packageLossMonitorRouter } from './routes/packageLossMonitorRouter'
import { supplierConfigScopeRouter } from './routes/supplierConfigScopeRouter'
import { userPreferencesRouter } from './routes/userPreferencesRouter'

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
app.use(imileHubcodeMiddleware)

app.get('/health', async (_req, res) => {
  const dbOk = await pingDatabase().catch(() => false)
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk ? 'up' : 'down' })
})

app.use('/api/auth', authRouter)
app.use('/api/admin/users', adminUsersRouter)
// 飞书卡片按钮点击回调：请求方是飞书服务器，不带我方登录态，靠 Verification Token 校验，不挂 requireAuth
app.use('/api/feishu-events', feishuEventRouter)

app.use('/api/order-exception', requireAuth, orderExceptionRouter)
app.use('/api/scanner-efficiency', requireAuth, scannerEfficiencyRouter)
app.use('/api/new-merchant', requireAuth, newMerchantRouter)
app.use('/api/weekly-report-insight', requireAuth, weeklyReportInsightRouter)
app.use('/api/efficiency-insight', requireAuth, efficiencyInsightRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/problem-audit', requireAuth, problemPackageAuditRouter)
app.use('/api/vendor-analysis', requireAuth, vendorAnalysisRouter)
app.use('/api/vendor-region-map', requireAuth, vendorRegionMapRouter)
// 供应商日报外部门户：凭分享 token 访问，不走登录鉴权
app.use('/api/vendor-portal', vendorPortalRouter)
// 催派推送外部门户：凭分享 token 查看滞留运单明细，不走登录鉴权
app.use('/api/chase-dispatch-portal', chaseDispatchPortalRouter)
app.use('/api/fleet-supplier-push', requireAuth, fleetSupplierPushRouter)
app.use('/api/supplier-config-scopes', requireAuth, supplierConfigScopeRouter)
app.use('/api/user-preferences', requireAuth, userPreferencesRouter)
app.use('/api/feishu-webhook', requireAuth, feishuWebhookTestRouter)
app.use('/api/exit-alarm', requireAuth, exitAlarmRouter)
app.use('/api/chase-dispatch', requireAuth, chaseDispatchRouter)
app.use('/api/work-order-push', requireAuth, workOrderPushRouter)
app.use('/api/dispatch-alarm', requireAuth, dispatchAlarmRouter)
// 24小时派签告警外部门户：凭分享 token 查看未达标运单明细，不走登录鉴权
app.use('/api/dispatch-alarm-portal', dispatchAlarmPortalRouter)
app.use('/api/delivering-notify', requireAuth, deliveringNotifyRouter)
app.use('/api/return-to-merchant', requireAuth, returnToMerchantRouter)
app.use('/api/attendance-work-time', requireAuth, attendanceWorkTimeRouter)
app.use('/api/container-management', requireAuth, containerManagementRouter)
app.use('/api/package-loss-monitor', requireAuth, packageLossMonitorRouter)

export { app }
