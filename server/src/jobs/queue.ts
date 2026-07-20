import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { jobs, type Job } from '../db/schema'
import { computeArtifactExpiresAt } from './artifactStore'
import type { EnqueueJobInput, JobProgress, JobStatus } from './types'

export class JobQueueError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate' | 'not_found' | 'invalid_state',
  ) {
    super(message)
    this.name = 'JobQueueError'
  }
}

function normalizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  return payload
}

export async function enqueueJob(input: EnqueueJobInput): Promise<Job> {
  const db = getDb()
  const type = String(input.type ?? '').trim()
  if (!type) {
    throw new JobQueueError('job type is required', 'invalid_state')
  }

  const regionCode = input.regionCode == null ? null : String(input.regionCode).trim() || null
  const idempotencyKey =
    input.idempotencyKey == null ? null : String(input.idempotencyKey).trim() || null

  if (idempotencyKey) {
    const [existing] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, idempotencyKey)).limit(1)
    if (existing) return existing
  }

  const [created] = await db
    .insert(jobs)
    .values({
      type,
      regionCode,
      status: 'pending',
      idempotencyKey,
      payload: normalizePayload(input.payload),
      progress: {},
      createdBy: input.createdBy ?? null,
      maxAttempts: input.maxAttempts ?? 3,
      attemptCount: 0,
    })
    .returning()

  return created
}

export async function getJobById(jobId: string): Promise<Job | null> {
  const db = getDb()
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
  return row ?? null
}

export async function listJobs(input: {
  regionCode?: string | null
  status?: JobStatus
  type?: string
  limit?: number
  offset?: number
}): Promise<{ rows: Job[]; total: number }> {
  const db = getDb()
  const filters = []

  if (input.regionCode) filters.push(eq(jobs.regionCode, input.regionCode))
  if (input.status) filters.push(eq(jobs.status, input.status))
  if (input.type) filters.push(eq(jobs.type, input.type))

  const whereClause = filters.length ? and(...filters) : undefined
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
  const offset = Math.max(input.offset ?? 0, 0)

  const rows = await db
    .select()
    .from(jobs)
    .where(whereClause)
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(whereClause)

  return { rows, total: countRow?.count ?? 0 }
}

export async function claimNextJob(workerId: string): Promise<Job | null> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.status, 'pending'), sql`${jobs.attemptCount} < ${jobs.maxAttempts}`),
      )
      .orderBy(asc(jobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })

    if (!candidate) return null

    const now = new Date()
    const [claimed] = await tx
      .update(jobs)
      .set({
        status: 'running',
        lockedBy: workerId,
        lockedAt: now,
        startedAt: candidate.startedAt ?? now,
        attemptCount: candidate.attemptCount + 1,
        updatedAt: now,
        error: null,
      })
      .where(eq(jobs.id, candidate.id))
      .returning()

    return claimed ?? null
  })
}

export async function updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db
    .update(jobs)
    .set({
      progress,
      // 进度上报兼作存活心跳：lockedAt 不刷新的话，长任务跑到 staleLockMinutes 就会被误判死锁、
      // 重置回 pending 后被另一个 worker 槽位重复执行
      lockedAt: now,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId))
}

export async function completeJob(jobId: string, artifactPayload: unknown | null): Promise<Job | null> {
  const db = getDb()
  const now = new Date()
  const [updated] = await db
    .update(jobs)
    .set({
      status: 'succeeded',
      artifactPayload: artifactPayload ?? null,
      artifactExpiresAt: artifactPayload != null ? computeArtifactExpiresAt(now) : null,
      finishedAt: now,
      updatedAt: now,
      lockedBy: null,
      lockedAt: null,
      error: null,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
    .returning()

  return updated ?? null
}

export async function failJob(jobId: string, errorMessage: string): Promise<Job | null> {
  const db = getDb()
  const [current] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
  if (!current || current.status !== 'running') return null

  const now = new Date()
  const shouldRetry = current.attemptCount < current.maxAttempts
  const [updated] = await db
    .update(jobs)
    .set({
      status: shouldRetry ? 'pending' : 'failed',
      error: errorMessage.slice(0, 2048),
      finishedAt: shouldRetry ? null : now,
      updatedAt: now,
      lockedBy: null,
      lockedAt: null,
    })
    .where(eq(jobs.id, jobId))
    .returning()

  return updated ?? null
}

export async function cancelJob(jobId: string): Promise<Job | null> {
  const db = getDb()
  const now = new Date()
  const [updated] = await db
    .update(jobs)
    .set({
      status: 'cancelled',
      finishedAt: now,
      updatedAt: now,
      lockedBy: null,
      lockedAt: null,
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'pending')))
    .returning()

  return updated ?? null
}

export async function deleteJob(jobId: string): Promise<boolean> {
  const db = getDb()
  const result = await db.delete(jobs).where(eq(jobs.id, jobId)).returning({ id: jobs.id })
  return result.length > 0
}

/**
 * 把 patch 合并进任务的 payload（浅合并，仅覆盖 patch 里的键）。
 * 用于任务创建后编辑「输出配置」类字段（不参与分析、不影响幂等/结果），如推送供应商范围、AI 开关、扩展模块。
 */
export async function updateJobPayload(jobId: string, patch: Record<string, unknown>): Promise<Job | null> {
  const db = getDb()
  const [current] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
  if (!current) return null
  const nextPayload = { ...(current.payload as Record<string, unknown>), ...patch }
  const [updated] = await db
    .update(jobs)
    .set({ payload: nextPayload, updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning()
  return updated ?? null
}

export async function recoverStaleRunningJobs(staleLockMinutes: number): Promise<number> {
  const db = getDb()
  const cutoff = new Date(Date.now() - staleLockMinutes * 60 * 1000)
  const stale = await db
    .select({ id: jobs.id, attemptCount: jobs.attemptCount, maxAttempts: jobs.maxAttempts })
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff)))

  if (!stale.length) return 0

  // 还有重试余额的回 pending 等待重新认领；已耗尽的直接终结为 failed，
  // 否则会卡成永远无人认领的僵尸 pending（claimNextJob 要求 attemptCount < maxAttempts）
  const retryIds = stale.filter((row) => row.attemptCount < row.maxAttempts).map((row) => row.id)
  const exhaustedIds = stale.filter((row) => row.attemptCount >= row.maxAttempts).map((row) => row.id)
  const now = new Date()
  let recovered = 0

  if (retryIds.length) {
    const updated = await db
      .update(jobs)
      .set({
        status: 'pending',
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
        error: 'stale lock recovered',
      })
      .where(inArray(jobs.id, retryIds))
      .returning({ id: jobs.id })
    recovered += updated.length
  }

  if (exhaustedIds.length) {
    const updated = await db
      .update(jobs)
      .set({
        status: 'failed',
        lockedBy: null,
        lockedAt: null,
        finishedAt: now,
        updatedAt: now,
        error: 'stale lock recovered: max attempts exhausted',
      })
      .where(inArray(jobs.id, exhaustedIds))
      .returning({ id: jobs.id })
    recovered += updated.length
  }

  return recovered
}
