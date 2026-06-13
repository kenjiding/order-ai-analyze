import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import { AU_REGIONS, SYSTEM_REGION, SYSTEM_REGION_CODE } from '../regions/registry'
import { PERMISSION_REGISTRY, SUPER_ADMIN_ROLE } from '../permissions/registry'
import { getDb } from './index'
import { permissions, regions, userPermissions, users } from './schema'

const BCRYPT_ROUNDS = 12

function resolveSuperAdminUsername(): string {
  const fromUsername = String(process.env.SUPER_ADMIN_USERNAME ?? '').trim()
  if (fromUsername) return fromUsername
  const fromEmail = String(process.env.SUPER_ADMIN_EMAIL ?? '').trim()
  if (fromEmail.includes('@')) return fromEmail.split('@')[0] ?? 'admin'
  if (fromEmail) return fromEmail
  return 'admin'
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
      regionId: null,
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
  const rows = await db
    .select({ key: userPermissions.permissionKey })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))
  return rows.map((row) => row.key)
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
