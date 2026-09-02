/**
 * 容器管理的数据可见范围：super_admin 不受限，普通用户只能看到自己绑定的站点账户相关数据。
 *
 * 与 jobs/access.ts 的区域过滤不同，这里返回 null 明确表示「不限」，
 * 避免调用方把「超管」误当成「无任何账户」。
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { SUPER_ADMIN_ROLE } from '../permissions/registry'

/** null = 不限（超管）；string[] = 该用户绑定的账户 id，可能为空数组 */
export type VisibleAccounts = string[] | null

export function isSuperAdmin(req: AuthenticatedRequest): boolean {
  return req.authUser?.role === SUPER_ADMIN_ROLE
}

export function hasContainerPermission(req: AuthenticatedRequest, permissionKey: string): boolean {
  if (isSuperAdmin(req)) return true
  return req.permissions?.includes(permissionKey) === true
}

export async function resolveVisibleAccountIds(req: AuthenticatedRequest): Promise<VisibleAccounts> {
  if (isSuperAdmin(req)) return null
  const userId = req.authUser?.id
  if (!userId) return []
  const rows = await getDb()
    .select({ accountId: schema.containerAccountUsers.accountId })
    .from(schema.containerAccountUsers)
    .where(eq(schema.containerAccountUsers.userId, userId))
  return rows.map((row) => row.accountId)
}

/** 该用户是否可以以此账户的身份操作（创建流转、改台账、确认收货等） */
export function canActAsAccount(visible: VisibleAccounts, accountId: string): boolean {
  if (visible === null) return true
  return visible.includes(accountId)
}

/** 流转记录的可见性：转出方或接收方任一在可见范围内即可查看 */
export function canViewTransfer(
  visible: VisibleAccounts,
  transfer: { fromAccountId: string; toAccountId: string },
): boolean {
  if (visible === null) return true
  return visible.includes(transfer.fromAccountId) || visible.includes(transfer.toAccountId)
}

/** 查询已绑定用户的账户 id 集合，用于「接收方」下拉排除自己 */
export async function listAccountUserIds(accountIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (accountIds.length === 0) return result
  const rows = await getDb()
    .select({
      accountId: schema.containerAccountUsers.accountId,
      userId: schema.containerAccountUsers.userId,
    })
    .from(schema.containerAccountUsers)
    .where(inArray(schema.containerAccountUsers.accountId, accountIds))
  for (const row of rows) {
    const list = result.get(row.accountId) ?? []
    list.push(row.userId)
    result.set(row.accountId, list)
  }
  return result
}

/**
 * 批量查出「在本系统没有账号」的账户 id。
 *
 * 这些账户方登不进来，所以放宽两处校验：可以作为转出方被内部人员代录（归还单），
 * 作为接收方时由转出方凭线下回单代确认。用显式开关而不是「有没有绑定用户」来判断 ——
 * 绑定关系是会变动的运维数据，临时解绑不该静默打开代操作的口子。
 */
export async function listExternalAccountIds(accountIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(accountIds)].filter((id) => id)
  if (ids.length === 0) return new Set()
  const rows = await getDb()
    .select({ id: schema.containerAccounts.id })
    .from(schema.containerAccounts)
    .where(
      and(
        inArray(schema.containerAccounts.id, ids),
        eq(schema.containerAccounts.isExternal, true),
      ),
    )
  return new Set(rows.map((row) => row.id))
}

export async function isUserBoundToAccount(userId: string, accountId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ userId: schema.containerAccountUsers.userId })
    .from(schema.containerAccountUsers)
    .where(
      and(
        eq(schema.containerAccountUsers.userId, userId),
        eq(schema.containerAccountUsers.accountId, accountId),
      ),
    )
    .limit(1)
  return rows.length > 0
}
