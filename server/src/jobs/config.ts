import os from 'node:os'

export function readJobWorkerConcurrency(): number {
  const raw = Number.parseInt(String(process.env.JOB_WORKER_CONCURRENCY ?? ''), 10)
  if (!Number.isFinite(raw)) return 2
  if (raw < 1) return 1
  if (raw > 8) return 8
  return raw
}

export function readJobPollIntervalMs(): number {
  const raw = Number.parseInt(String(process.env.JOB_POLL_INTERVAL_MS ?? ''), 10)
  if (!Number.isFinite(raw)) return 3000
  if (raw < 500) return 500
  return raw
}

export function readJobStaleLockMinutes(): number {
  const raw = Number.parseInt(String(process.env.JOB_STALE_LOCK_MINUTES ?? ''), 10)
  if (!Number.isFinite(raw)) return 30
  if (raw < 5) return 5
  return raw
}

export function readJobArtifactDir(): string {
  const raw = String(process.env.JOB_ARTIFACT_DIR ?? '').trim()
  return raw || '/data/job-artifacts'
}

export function readJobArtifactTtlHours(): number {
  const raw = Number.parseInt(String(process.env.JOB_ARTIFACT_TTL_HOURS ?? ''), 10)
  if (!Number.isFinite(raw)) return 24
  if (raw < 1) return 1
  return raw
}

export function readJobArtifactCleanupIntervalMs(): number {
  const raw = Number.parseInt(String(process.env.JOB_ARTIFACT_CLEANUP_INTERVAL_MS ?? ''), 10)
  if (!Number.isFinite(raw)) return 60 * 60 * 1000
  if (raw < 60_000) return 60_000
  return raw
}

export function readJobSchedulerEnabled(): boolean {
  return String(process.env.JOB_SCHEDULER_ENABLED ?? '').trim().toLowerCase() === 'true'
}

export function createWorkerId(): string {
  return `${os.hostname()}-${process.pid}-${Date.now().toString(36)}`
}
