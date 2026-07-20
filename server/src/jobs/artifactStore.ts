import { and, isNotNull, lte } from 'drizzle-orm'
import { getDb } from '../db'
import { jobs } from '../db/schema'
import { readJobArtifactTtlHours } from './config'

export function computeArtifactExpiresAt(from = new Date()): Date {
  const hours = readJobArtifactTtlHours()
  return new Date(from.getTime() + hours * 60 * 60 * 1000)
}

export function isArtifactExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() <= now.getTime()
}

/** 清空已过期任务的 artifact_payload，回收数据库存储空间 */
export async function cleanupExpiredArtifacts(now = new Date()): Promise<number> {
  const db = getDb()
  const updated = await db
    .update(jobs)
    .set({ artifactPayload: null })
    .where(and(isNotNull(jobs.artifactPayload), lte(jobs.artifactExpiresAt, now)))
    .returning({ id: jobs.id })
  return updated.length
}
