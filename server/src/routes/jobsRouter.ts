import { Router, type Request, type Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware'
import {
  canAccessJob,
  parseOptionalRegionFilter,
  resolveEnqueueRegionCode,
  sendJobAccessDenied,
} from '../jobs/access'
import { isArtifactExpired, readJobArtifactJson } from '../jobs/artifactStore'
import { enqueueJob, cancelJob, getJobById, listJobs, JobQueueError } from '../jobs/queue'
import { listRegisteredJobTypes } from '../jobs/registry'
import { JOB_STATUSES, toPublicJob, type JobStatus } from '../jobs/types'

export const jobsRouter = Router()

jobsRouter.use(requireAuth)

function readJsonObject(body: unknown): Record<string, unknown> | null {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

jobsRouter.get('/types', (_req: Request, res: Response) => {
  res.json({ types: listRegisteredJobTypes() })
})

jobsRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const body = readJsonObject(req.body)
  if (!body) {
    res.status(400).json({ error: '请求体须为 JSON 对象' })
    return
  }

  const type = String(body.type ?? '').trim()
  if (!type) {
    res.status(400).json({ error: '缺少 type' })
    return
  }

  const regionResult = resolveEnqueueRegionCode(req, body.regionCode)
  if (regionResult === 'forbidden') {
    sendJobAccessDenied(res)
    return
  }
  if (regionResult === 'invalid') {
    res.status(400).json({ error: '无效的 regionCode' })
    return
  }

  const payload = readJsonObject(body.payload) ?? {}
  const idempotencyKey =
    body.idempotencyKey == null ? null : String(body.idempotencyKey).trim() || null

  try {
    const job = await enqueueJob({
      type,
      regionCode: regionResult,
      payload,
      idempotencyKey,
      createdBy: req.authUser?.id ?? null,
    })
    res.status(201).json({ job: toPublicJob(job) })
  } catch (error) {
    if (error instanceof JobQueueError) {
      res.status(400).json({ error: error.message })
      return
    }
    res.status(500).json({ error: (error as Error).message || '入队失败' })
  }
})

jobsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const regionResult = parseOptionalRegionFilter(req, req.query.regionCode)
  if (regionResult === 'forbidden') {
    sendJobAccessDenied(res)
    return
  }
  if (regionResult === 'invalid') {
    res.status(400).json({ error: '无效的 regionCode' })
    return
  }

  const statusRaw = String(req.query.status ?? '').trim()
  const status = JOB_STATUSES.includes(statusRaw as JobStatus) ? (statusRaw as JobStatus) : undefined
  const type = String(req.query.type ?? '').trim() || undefined
  const limit = Number.parseInt(String(req.query.limit ?? ''), 10)
  const offset = Number.parseInt(String(req.query.offset ?? ''), 10)

  const result = await listJobs({
    regionCode: regionResult ?? undefined,
    status,
    type,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  })

  res.json({
    total: result.total,
    jobs: result.rows.map(toPublicJob),
  })
})

jobsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const job = await getJobById(String(req.params.id))
  if (!job) {
    res.status(404).json({ error: '任务不存在' })
    return
  }
  if (!canAccessJob(req, job)) {
    sendJobAccessDenied(res)
    return
  }
  res.json({ job: toPublicJob(job) })
})

jobsRouter.get('/:id/artifact', async (req: AuthenticatedRequest, res: Response) => {
  const job = await getJobById(String(req.params.id))
  if (!job) {
    res.status(404).json({ error: '任务不存在' })
    return
  }
  if (!canAccessJob(req, job)) {
    sendJobAccessDenied(res)
    return
  }
  if (!job.artifactPath) {
    res.status(404).json({ error: '任务尚无 artifact' })
    return
  }
  if (isArtifactExpired(job.artifactExpiresAt)) {
    res.status(410).json({ error: 'artifact 已过期' })
    return
  }

  try {
    const data = await readJobArtifactJson(job.artifactPath)
    res.json({ artifact: data })
  } catch {
    res.status(404).json({ error: 'artifact 文件不存在' })
  }
})

jobsRouter.post('/:id/cancel', async (req: AuthenticatedRequest, res: Response) => {
  const job = await getJobById(String(req.params.id))
  if (!job) {
    res.status(404).json({ error: '任务不存在' })
    return
  }
  if (!canAccessJob(req, job)) {
    sendJobAccessDenied(res)
    return
  }

  const updated = await cancelJob(job.id)
  if (!updated) {
    res.status(409).json({ error: '仅 pending 状态的任务可取消' })
    return
  }

  res.json({ job: toPublicJob(updated) })
})
