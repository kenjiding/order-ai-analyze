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

/** iMile token 失效检测的 cron 表达式；默认每天 08:00 与 15:00 各一次 */
export const DEFAULT_IMILE_TOKEN_CHECK_CRON = '0 8,15 * * *'

/** 检测时刻所在时区；与业务口径一致，默认墨尔本 */
export const DEFAULT_IMILE_TOKEN_CHECK_TIME_ZONE = 'Australia/Melbourne'

export function readImileTokenCheckCron(): string {
  return process.env.IMILE_TOKEN_CHECK_CRON?.trim() || DEFAULT_IMILE_TOKEN_CHECK_CRON
}

export function readImileTokenCheckTimeZone(): string {
  return process.env.IMILE_TOKEN_CHECK_TIMEZONE?.trim() || DEFAULT_IMILE_TOKEN_CHECK_TIME_ZONE
}

export function createWorkerId(): string {
  return `${os.hostname()}-${process.pid}-${Date.now().toString(36)}`
}
