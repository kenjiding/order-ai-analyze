import { eq } from 'drizzle-orm'
import type { Response } from 'express'
import { getDb } from '../db'
import { getUserPermissionKeys } from '../db/seed'
import { regions, users } from '../db/schema'
import { isValidUsername, normalizeUsername } from '../regions/registry'
import { SUPER_ADMIN_ROLE } from '../permissions/registry'
import type { AuthenticatedRequest } from '../auth/middleware'
import { clearAuthCookie, setAuthCookie, signAuthToken, toPublicUser, verifyPassword } from '../auth/jwt'

export async function loginUser(
  _req: AuthenticatedRequest,
  res: Response,
  username: string,
  password: string,
): Promise<void> {
  const normalizedUsername = normalizeUsername(username)
  if (!normalizedUsername || !password) {
    res.status(400).json({ error: '请输入用户名和密码' })
    return
  }
  if (!isValidUsername(normalizedUsername)) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }

  const db = getDb()
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      regionId: users.regionId,
      regionName: regions.name,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.code))
    .where(eq(users.username, normalizedUsername))
    .limit(1)

  if (!user || !user.isActive) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    res.status(401).json({ error: '用户名或密码错误' })
    return
  }

  const token = signAuthToken({
    sub: user.id,
    username: user.username,
    role: user.role as 'super_admin' | 'user',
    regionCode: user.regionId,
  })
  setAuthCookie(res, token)

  const permissionKeys =
    user.role === SUPER_ADMIN_ROLE ? ['*'] : await getUserPermissionKeys(user.id)

  res.json({
    user: toPublicUser(user),
    permissions: permissionKeys,
  })
}

export function logoutUser(_req: AuthenticatedRequest, res: Response): void {
  clearAuthCookie(res)
  res.json({ ok: true })
}

export async function getCurrentUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (!req.authUser) {
    res.status(401).json({ error: '未登录' })
    return
  }
  res.json({
    user: req.authUser,
    permissions: req.permissions ?? [],
  })
}
