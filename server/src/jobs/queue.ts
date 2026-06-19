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
  await db
    .update(jobs)
    .set({
      progress,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId))
}

export async function completeJob(jobId: string, artifactRelPath: string): Promise<Job | null> {
  const db = getDb()
  const now = new Date()
  const [updated] = await db
    .update(jobs)
    .set({
      status: 'succeeded',
      artifactPath: artifactRelPath,
      artifactExpiresAt: computeArtifactExpiresAt(now),
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

export async function recoverStaleRunningJobs(staleLockMinutes: number): Promise<number> {
  const db = getDb()
  const cutoff = new Date(Date.now() - staleLockMinutes * 60 * 1000)
  const stale = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedAt, cutoff)))

  if (!stale.length) return 0

  const ids = stale.map((row) => row.id)
  const now = new Date()
  const updated = await db
    .update(jobs)
    .set({
      status: 'pending',
      lockedBy: null,
      lockedAt: null,
      updatedAt: now,
      error: 'stale lock recovered',
    })
    .where(inArray(jobs.id, ids))
    .returning({ id: jobs.id })

  return updated.length
}
