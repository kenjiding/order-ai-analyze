import type { Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { hasPermission } from '../auth/middleware'

/** 与 src/permissions/pushNotificationAccess.ts 的 PushApiScope 保持一致 */
export const PUSH_API_SCOPES = [
  'warehouse-efficiency',
  'attendance-scheduling',
  'fleet-supplier',
  'order-exception',
  'vendor-analysis',
] as const

export type PushApiScope = (typeof PUSH_API_SCOPES)[number]

const PUSH_API_SCOPE_PERMISSION: Record<PushApiScope, string> = {
  'warehouse-efficiency': 'btn:push-notifications:warehouse-efficiency',
  'attendance-scheduling': 'btn:push-notifications:attendance-scheduling',
  'fleet-supplier': 'btn:push-notifications:fleet-supplier',
  'order-exception': 'btn:push-notifications:order-exception',
  'vendor-analysis': 'btn:vendor-analysis:push',
}

export function parsePushApiScope(raw: unknown): PushApiScope | null {
  if (typeof raw !== 'string') return null
  return PUSH_API_SCOPES.includes(raw as PushApiScope) ? (raw as PushApiScope) : null
}

export function canAccessPushApiScope(req: AuthenticatedRequest, scope: PushApiScope): boolean {
  if (!req.authUser) return false
  return hasPermission(req.authUser.role, req.permissions, PUSH_API_SCOPE_PERMISSION[scope])
}

export function requirePushApiScope(
  req: AuthenticatedRequest,
  res: Response,
): PushApiScope | null {
  const scope = parsePushApiScope((req.body as { pushScope?: unknown } | undefined)?.pushScope)
  if (!scope) {
    res.status(400).json({ ok: false, error: '缺少有效的 pushScope' })
    return null
  }
  if (!canAccessPushApiScope(req, scope)) {
    res.status(403).json({ ok: false, error: '无操作权限' })
    return null
  }
  return scope
}
