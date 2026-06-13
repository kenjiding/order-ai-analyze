import type { Job } from '../db/schema'

export const JOB_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export type JobProgress = Record<string, unknown>

export type JobHandlerResult = {
  artifactRelPath: string
}

export type ArtifactWriter = {
  writeJson: (data: unknown) => Promise<string>
}

export type JobHandlerContext = {
  job: Job
  signal: AbortSignal
  reportProgress: (progress: JobProgress) => Promise<void>
  artifact: ArtifactWriter
}

export type JobHandler = {
  readonly type: string
  run: (ctx: JobHandlerContext) => Promise<JobHandlerResult>
}

export type EnqueueJobInput = {
  type: string
  regionCode?: string | null
  payload?: Record<string, unknown>
  idempotencyKey?: string | null
  createdBy?: string | null
  maxAttempts?: number
}

export type PublicJob = {
  id: string
  type: string
  regionCode: string | null
  status: JobStatus
  idempotencyKey: string | null
  payload: Record<string, unknown>
  progress: JobProgress
  error: string | null
  artifactPath: string | null
  artifactExpiresAt: string | null
  createdBy: string | null
  attemptCount: number
  maxAttempts: number
  lockedBy: string | null
  lockedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export function toPublicJob(row: Job): PublicJob {
  return {
    id: row.id,
    type: row.type,
    regionCode: row.regionCode,
    status: row.status as JobStatus,
    idempotencyKey: row.idempotencyKey,
    payload: (row.payload as Record<string, unknown>) ?? {},
    progress: (row.progress as JobProgress) ?? {},
    error: row.error,
    artifactPath: row.artifactPath,
    artifactExpiresAt: row.artifactExpiresAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
