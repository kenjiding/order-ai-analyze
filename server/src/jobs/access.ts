import type { Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { SUPER_ADMIN_ROLE } from '../permissions/registry'
import { isAssignableRegionCode } from '../regions/registry'
import type { Job } from '../db/schema'

export function canAccessJob(req: AuthenticatedRequest, job: Job): boolean {
  const user = req.authUser
  if (!user) return false
  if (user.role === SUPER_ADMIN_ROLE) return true

  if (job.regionCode) {
    return job.regionCode === user.regionCode
  }

  return job.createdBy === user.id
}

export function resolveEnqueueRegionCode(req: AuthenticatedRequest, raw: unknown): string | null | 'forbidden' | 'invalid' {
  const user = req.authUser
  if (!user) return 'forbidden'

  if (raw == null || String(raw).trim() === '') {
    if (user.role === SUPER_ADMIN_ROLE) return null
    return user.regionCode
  }

  const regionCode = String(raw).trim()
  if (!isAssignableRegionCode(regionCode)) return 'invalid'

  if (user.role === SUPER_ADMIN_ROLE) return regionCode
  if (user.regionCode !== regionCode) return 'forbidden'
  return regionCode
}

export function parseOptionalRegionFilter(req: AuthenticatedRequest, raw: unknown): string | null | 'forbidden' | 'invalid' {
  const user = req.authUser
  if (!user) return 'forbidden'

  if (user.role !== SUPER_ADMIN_ROLE) {
    return user.regionCode
  }

  if (raw == null || String(raw).trim() === '') return null
  const regionCode = String(raw).trim()
  if (!isAssignableRegionCode(regionCode)) return 'invalid'
  return regionCode
}

export function sendJobAccessDenied(res: Response): void {
  res.status(403).json({ error: '无权访问该任务' })
}
