import { eq } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import { getDb } from '../db'
import { getUserPermissionKeys } from '../db/seed'
import { regions, users } from '../db/schema'
import { getRegionLabel } from '../regions/registry'
import { SUPER_ADMIN_ROLE, type UserRole } from '../permissions/registry'
import { verifyAuthToken, AUTH_COOKIE_NAME, type PublicUser, toPublicUser } from './jwt'

export type AuthenticatedRequest = Request & {
  authUser?: PublicUser
  permissions?: string[]
}

function readTokenFromRequest(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME]
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim()
  }
  const authHeader = String(req.headers.authorization ?? '').trim()
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim()
  }
  return null
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = readTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ error: '未登录' })
    return
  }

  const payload = verifyAuthToken(token)
  if (!payload) {
    res.status(401).json({ error: '登录已过期，请重新登录' })
    return
  }

  const db = getDb()
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      regionId: users.regionId,
      regionName: regions.name,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.code))
    .where(eq(users.id, payload.sub))
    .limit(1)
  if (!user || !user.isActive) {
    res.status(401).json({ error: '账号不可用' })
    return
  }

  req.authUser = toPublicUser({
    ...user,
    regionName: user.regionName ?? getRegionLabel(user.regionId),
  })
  if (user.role === SUPER_ADMIN_ROLE) {
    req.permissions = ['*']
  } else {
    req.permissions = await getUserPermissionKeys(user.id)
  }
  next()
}

export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: '未登录' })
    return
  }
  if (req.authUser.role !== SUPER_ADMIN_ROLE) {
    res.status(403).json({ error: '需要超级管理员权限' })
    return
  }
  next()
}

export function requirePermission(permissionKey: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: '未登录' })
      return
    }
    if (req.authUser.role === SUPER_ADMIN_ROLE) {
      next()
      return
    }
    if (req.permissions?.includes(permissionKey)) {
      next()
      return
    }
    res.status(403).json({ error: '无操作权限' })
  }
}

export function hasPermission(userRole: UserRole, permissions: string[] | undefined, key: string): boolean {
  if (userRole === SUPER_ADMIN_ROLE) return true
  return permissions?.includes(key) ?? false
}
