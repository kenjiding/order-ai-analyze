import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { hashPassword, toPublicUser } from '../auth/jwt'
import { getDb } from '../db'
import { getUserPermissionKeys, setUserPermissionKeys } from '../db/seed'
import { regions, users } from '../db/schema'
import {
  USER_ASSIGNABLE_REGIONS,
  getRegionLabel,
  isAssignableRegionCode,
  isValidUsername,
  normalizeUsername,
} from '../regions/registry'
import {
  ASSIGNABLE_PERMISSION_REGISTRY,
  DEFAULT_GRANTED_PERMISSION_KEYS,
  SUPER_ADMIN_ROLE,
  USER_ROLE,
  type UserRole,
} from '../permissions/registry'

type CreateUserBody = {
  username?: string
  regionCode?: string
  password?: string
  displayName?: string
  permissionKeys?: string[]
}

type UpdateUserBody = {
  username?: string
  displayName?: string
  isActive?: boolean
  password?: string
}

function isValidAssignablePermissionKeys(keys: string[]): boolean {
  const allowed = new Set(ASSIGNABLE_PERMISSION_REGISTRY.map((item) => item.key))
  return keys.every((key) => allowed.has(key))
}

async function loadPublicUser(userId: string) {
  const db = getDb()
  const [row] = await db
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
    .where(eq(users.id, userId))
    .limit(1)
  return row
}

export async function listAssignableRegions(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.json({ regions: USER_ASSIGNABLE_REGIONS })
}

export async function listUsers(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const db = getDb()
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      regionId: users.regionId,
      regionName: regions.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.code))
    .orderBy(asc(users.createdAt))

  const result = await Promise.all(
    rows.map(async (user) => ({
      ...toPublicUser({
        ...user,
        regionName: user.regionName ?? (user.regionId ? getRegionLabel(user.regionId) : null),
      }),
      permissions: user.role === SUPER_ADMIN_ROLE ? ['*'] : await getUserPermissionKeys(user.id),
    })),
  )
  res.json({ users: result })
}

export async function listPermissions(_req: AuthenticatedRequest, res: Response): Promise<void> {
  res.json({ permissions: ASSIGNABLE_PERMISSION_REGISTRY })
}

export async function createUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as CreateUserBody
  const username = normalizeUsername(String(body.username ?? ''))
  const regionCode = String(body.regionCode ?? '').trim().toUpperCase()
  const password = String(body.password ?? '')
  const displayName = String(body.displayName ?? '').trim() || null
  const permissionKeys = Array.isArray(body.permissionKeys) ? body.permissionKeys.map(String) : []

  if (!username || !password || !regionCode) {
    res.status(400).json({ error: '州/区域、用户名和密码不能为空' })
    return
  }
  if (!isValidUsername(username)) {
    res.status(400).json({ error: '用户名须为 2–64 位字母、数字、下划线、点或连字符' })
    return
  }
  if (!isAssignableRegionCode(regionCode)) {
    res.status(400).json({ error: '无效的州/区域' })
    return
  }
  if (password.length < 8) {
    res.status(400).json({ error: '密码至少 8 位' })
    return
  }
  if (!isValidAssignablePermissionKeys(permissionKeys)) {
    res.status(400).json({ error: '包含无效的权限 key' })
    return
  }

  const db = getDb()
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (existing.length > 0) {
    res.status(409).json({ error: '用户名已存在' })
    return
  }

  const passwordHash = await hashPassword(password)
  const [created] = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      displayName,
      regionId: regionCode,
      role: USER_ROLE,
      isActive: true,
    })
    .returning()

  if (!created) {
    res.status(500).json({ error: '创建用户失败' })
    return
  }

  // 默认全员开放的权限（见 DEFAULT_GRANTED_PERMISSION_KEYS）新建时直接带上，不用管理员记得手动勾；
  // 之后仍可在「编辑用户权限」里单独收回——那条路径不会再补发，收回是永久的
  const grantedKeys = [...new Set([...permissionKeys, ...DEFAULT_GRANTED_PERMISSION_KEYS])]
  await setUserPermissionKeys(created.id, grantedKeys)

  const publicUser = await loadPublicUser(created.id)
  res.status(201).json({
    user: {
      ...toPublicUser(publicUser!),
      permissions: grantedKeys,
    },
  })
}

export async function updateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = String(req.params.id ?? '')
  const body = req.body as UpdateUserBody
  const db = getDb()

  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!existing) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  if (existing.role === SUPER_ADMIN_ROLE && req.authUser?.id === existing.id && body.isActive === false) {
    res.status(400).json({ error: '不能禁用当前登录的超级管理员' })
    return
  }

  if (existing.role === SUPER_ADMIN_ROLE && body.isActive === false) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, SUPER_ADMIN_ROLE), eq(users.isActive, true), ne(users.id, userId)))
    if (Number(count) === 0) {
      res.status(400).json({ error: '不能禁用最后一个超级管理员' })
      return
    }
  }

  const patch: Partial<typeof users.$inferInsert> = {
    updatedAt: new Date(),
  }
  if (body.username !== undefined) {
    const username = normalizeUsername(String(body.username))
    if (!isValidUsername(username)) {
      res.status(400).json({ error: '用户名须为 2–64 位字母、数字、下划线、点或连字符' })
      return
    }
    if (username !== existing.username) {
      const duplicate = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1)
      if (duplicate.length > 0) {
        res.status(409).json({ error: '用户名已存在' })
        return
      }
      patch.username = username
    }
  }
  if (body.displayName !== undefined) {
    patch.displayName = String(body.displayName).trim() || null
  }
  if (body.isActive !== undefined) {
    patch.isActive = Boolean(body.isActive)
  }
  if (body.password !== undefined) {
    const password = String(body.password)
    if (password.length < 8) {
      res.status(400).json({ error: '密码至少 8 位' })
      return
    }
    patch.passwordHash = await hashPassword(password)
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning()
  if (!updated) {
    res.status(500).json({ error: '更新用户失败' })
    return
  }

  const publicUser = await loadPublicUser(updated.id)
  const permissionKeys =
    updated.role === SUPER_ADMIN_ROLE ? ['*'] : await getUserPermissionKeys(updated.id)

  res.json({
    user: {
      ...toPublicUser(publicUser!),
      permissions: permissionKeys,
    },
  })
}

export async function deleteUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = String(req.params.id ?? '')
  const db = getDb()

  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!existing) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  if (req.authUser?.id === existing.id) {
    res.status(400).json({ error: '不能删除当前登录账号' })
    return
  }

  if (existing.role === SUPER_ADMIN_ROLE) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, SUPER_ADMIN_ROLE), eq(users.isActive, true)))
    if (Number(count) <= 1) {
      res.status(400).json({ error: '不能删除最后一个超级管理员' })
      return
    }
  }

  await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, userId))
  res.json({ ok: true })
}

export async function updateUserPermissions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = String(req.params.id ?? '')
  const rawKeys = Array.isArray(req.body?.permissionKeys)
    ? (req.body.permissionKeys as unknown[]).map(String)
    : null

  if (!rawKeys) {
    res.status(400).json({ error: 'permissionKeys 必须为数组' })
    return
  }
  if (!isValidAssignablePermissionKeys(rawKeys)) {
    res.status(400).json({ error: '包含无效的权限 key' })
    return
  }
  const permissionKeys = rawKeys

  const db = getDb()
  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!existing) {
    res.status(404).json({ error: '用户不存在' })
    return
  }
  if (existing.role === SUPER_ADMIN_ROLE) {
    res.status(400).json({ error: '超级管理员拥有全部权限，无需配置' })
    return
  }

  await setUserPermissionKeys(userId, permissionKeys)
  res.json({ permissions: permissionKeys })
}

export type { UserRole }
