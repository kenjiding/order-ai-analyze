import bcrypt from 'bcrypt'
import { eq, notInArray, and, ne, inArray } from 'drizzle-orm'
import { AU_REGIONS, SYSTEM_REGION, SYSTEM_REGION_CODE } from '../regions/registry'
import {
  ASSIGNABLE_PERMISSION_REGISTRY,
  PERMISSION_REGISTRY,
  SUPER_ADMIN_ROLE,
} from '../permissions/registry'
import { getDb } from './index'
import { permissions, regions, userPermissions, users } from './schema'

const BCRYPT_ROUNDS = 12

const REGISTRY_PERMISSION_KEYS = PERMISSION_REGISTRY.map((item) => item.key)

function resolveSuperAdminUsername(): string {
  const fromUsername = String(process.env.SUPER_ADMIN_USERNAME ?? '').trim()
  if (fromUsername) return fromUsername
  const fromEmail = String(process.env.SUPER_ADMIN_EMAIL ?? '').trim()
  if (fromEmail.includes('@')) return fromEmail.split('@')[0] ?? 'admin'
  if (fromEmail) return fromEmail
  return 'admin'
}

async function syncPermissionRegistry(): Promise<void> {
  const db = getDb()

  for (const def of PERMISSION_REGISTRY) {
    await db
      .insert(permissions)
      .values({
        key: def.key,
        type: def.type,
        label: def.label,
        description: def.description ?? null,
        menuKey: def.menuKey ?? null,
        sortOrder: def.sortOrder,
      })
      .onConflictDoUpdate({
        target: permissions.key,
        set: {
          type: def.type,
          label: def.label,
          description: def.description ?? null,
          menuKey: def.menuKey ?? null,
          sortOrder: def.sortOrder,
        },
      })
  }

  // 权限定义以代码 registry 为唯一来源；移除已下线 key，级联清理 user_permissions
  await db.delete(permissions).where(notInArray(permissions.key, REGISTRY_PERMISSION_KEYS))
}

/** 将已下线的「发送推送」权限迁移为三个子权限，避免升级后已有用户失去推送能力 */
async function migrateLegacyPushSendPermission(): Promise<void> {
  const db = getDb()
  const legacyKey = 'btn:push-notifications:send'
  const nextKeys = [
    'btn:push-notifications:warehouse-efficiency',
    'btn:push-notifications:attendance-scheduling',
    'btn:push-notifications:fleet-supplier',
  ] as const

  const holders = await db
    .select({ userId: userPermissions.userId })
    .from(userPermissions)
    .where(eq(userPermissions.permissionKey, legacyKey))

  if (holders.length === 0) return

  for (const { userId } of holders) {
    for (const permissionKey of nextKeys) {
      await db
        .insert(userPermissions)
        .values({ userId, permissionKey })
        .onConflictDoNothing()
    }
  }

  await db.delete(userPermissions).where(eq(userPermissions.permissionKey, legacyKey))
}

async function cleanupInvalidUserPermissions(): Promise<void> {
  const db = getDb()
  const rows = await db
    .select({ userId: userPermissions.userId })
    .from(userPermissions)
    .innerJoin(users, eq(userPermissions.userId, users.id))
    .where(and(eq(userPermissions.permissionKey, 'menu:system-users'), ne(users.role, SUPER_ADMIN_ROLE)))

  const userIds = rows.map((row) => row.userId)
  if (userIds.length === 0) return

  await db
    .delete(userPermissions)
    .where(and(eq(userPermissions.permissionKey, 'menu:system-users'), inArray(userPermissions.userId, userIds)))
}

async function syncSuperAdminRegion(): Promise<void> {
  const db = getDb()
  await db
    .update(users)
    .set({ regionId: SYSTEM_REGION_CODE })
    .where(eq(users.role, SUPER_ADMIN_ROLE))
}

export async function seedDatabase(): Promise<void> {
  const db = getDb()

  const regionRows = [SYSTEM_REGION, ...AU_REGIONS]
  for (const def of regionRows) {
    await db
      .insert(regions)
      .values({
        code: def.code,
        name: def.name,
        nameEn: def.nameEn,
        sortOrder: def.sortOrder,
      })
      .onConflictDoUpdate({
        target: regions.code,
        set: {
          name: def.name,
          nameEn: def.nameEn,
          sortOrder: def.sortOrder,
        },
      })
  }

  await syncPermissionRegistry()
  await migrateLegacyPushSendPermission()
  await cleanupInvalidUserPermissions()
  await syncSuperAdminRegion()

  const existingSuperAdmins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, SUPER_ADMIN_ROLE))
    .limit(1)

  if (existingSuperAdmins.length > 0) {
    return
  }

  const username = resolveSuperAdminUsername()
  const password = String(process.env.SUPER_ADMIN_PASSWORD ?? '').trim()

  if (!password) {
    console.warn('[seed] SUPER_ADMIN_PASSWORD not set; skipping super admin creation')
    return
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const [created] = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      displayName: '超级管理员',
      regionId: SYSTEM_REGION_CODE,
      role: SUPER_ADMIN_ROLE,
      isActive: true,
    })
    .returning({ id: users.id })

  if (created) {
    console.log(`[seed] Created super admin: ${username} (region=${SYSTEM_REGION_CODE})`)
  }
}

export async function getUserPermissionKeys(userId: string): Promise<string[]> {
  const db = getDb()
  const assignableKeys = new Set(ASSIGNABLE_PERMISSION_REGISTRY.map((item) => item.key))
  const rows = await db
    .select({ key: userPermissions.permissionKey })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionKey, permissions.key))
    .where(eq(userPermissions.userId, userId))
  return rows.map((row) => row.key).filter((key) => assignableKeys.has(key))
}

export async function setUserPermissionKeys(userId: string, keys: string[]): Promise<void> {
  const db = getDb()
  await db.delete(userPermissions).where(eq(userPermissions.userId, userId))
  if (keys.length === 0) return
  await db.insert(userPermissions).values(
    keys.map((permissionKey) => ({
      userId,
      permissionKey,
    })),
  )
}

export { BCRYPT_ROUNDS }
