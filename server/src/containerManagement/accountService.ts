/** 容器管理：站点账户 CRUD 与用户绑定 */
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AccountKind } from './constants'
import {
  DEFAULT_ACCOUNT_PUSH_NOTIFY,
  normalizeAccountPushNotify,
  type AccountPushNotify,
} from './pushNotify'

export type AccountRow = {
  id: string
  name: string
  kind: string
  /** 该账户方在本系统没有登录账号，需要我方代为确认收货 / 代录归还 */
  isExternal: boolean
  boundUserIds: string[]
  pushNotify: AccountPushNotify
  createdAt: string
}

/** 业务规则冲突，路由层转 400/409 */
export class ContainerBusinessError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message)
    this.name = 'ContainerBusinessError'
  }
}

async function attachBoundUsers(
  rows: {
    id: string
    name: string
    kind: string
    isExternal: boolean
    pushNotify: unknown
    createdAt: Date
  }[],
): Promise<AccountRow[]> {
  if (rows.length === 0) return []
  const links = await getDb()
    .select({
      accountId: schema.containerAccountUsers.accountId,
      userId: schema.containerAccountUsers.userId,
    })
    .from(schema.containerAccountUsers)
    .where(
      inArray(
        schema.containerAccountUsers.accountId,
        rows.map((row) => row.id),
      ),
    )
  const byAccount = new Map<string, string[]>()
  for (const link of links) {
    const list = byAccount.get(link.accountId) ?? []
    list.push(link.userId)
    byAccount.set(link.accountId, list)
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    isExternal: row.isExternal,
    boundUserIds: byAccount.get(row.id) ?? [],
    pushNotify: normalizeAccountPushNotify(row.pushNotify),
    createdAt: row.createdAt.toISOString(),
  }))
}

/**
 * @param visibleAccountIds null 表示不限（超管）
 * @param counterparty true 时返回全部账户，供新增流转的「转出方 / 接收方」下拉使用 ——
 *   录单方常常要替别的站点补录，下拉按绑定关系裁剪只会逼人来回找管理员加绑定。
 *   真正的把关放在记录本身：谁能看、谁能确认收货仍按可见范围判。
 */
export async function listAccounts(
  visibleAccountIds: string[] | null,
  counterparty = false,
): Promise<AccountRow[]> {
  const db = getDb()
  const base = db
    .select({
      id: schema.containerAccounts.id,
      name: schema.containerAccounts.name,
      kind: schema.containerAccounts.kind,
      isExternal: schema.containerAccounts.isExternal,
      pushNotify: schema.containerAccounts.pushNotify,
      createdAt: schema.containerAccounts.createdAt,
    })
    .from(schema.containerAccounts)

  if (visibleAccountIds === null) {
    return attachBoundUsers(await base.orderBy(asc(schema.containerAccounts.name)))
  }
  if (counterparty) {
    return attachBoundUsers(await base.orderBy(asc(schema.containerAccounts.name)))
  }
  if (visibleAccountIds.length === 0) return []
  return attachBoundUsers(
    await base
      .where(inArray(schema.containerAccounts.id, visibleAccountIds))
      .orderBy(asc(schema.containerAccounts.name)),
  )
}

export async function getAccountById(id: string) {
  const rows = await getDb()
    .select()
    .from(schema.containerAccounts)
    .where(eq(schema.containerAccounts.id, id))
    .limit(1)
  return rows[0] ?? null
}

async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  const rows = await getDb()
    .select({ id: schema.containerAccounts.id })
    .from(schema.containerAccounts)
    .where(sql`lower(${schema.containerAccounts.name}) = lower(${name})`)
    .limit(2)
  const conflict = rows.find((row) => row.id !== excludeId)
  if (conflict) {
    throw new ContainerBusinessError('已存在同名站点账户', 409)
  }
}

export async function createAccount(input: {
  name: string
  kind: AccountKind
  isExternal?: boolean
  userIds?: string[]
  pushNotify?: AccountPushNotify
  createdBy: string | null
}): Promise<AccountRow> {
  await assertNameAvailable(input.name)
  const userIds = await assertUsersExist(input.userIds ?? [])
  const pushNotify = normalizeAccountPushNotify(input.pushNotify ?? DEFAULT_ACCOUNT_PUSH_NOTIFY)

  // 建账与绑定放同一个事务：否则绑定失败会留下一个没人能看见的孤儿站点
  const row = await getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.containerAccounts)
      .values({
        name: input.name,
        kind: input.kind,
        isExternal: input.isExternal === true,
        pushNotify,
        createdBy: input.createdBy,
      })
      .returning()
    if (userIds.length > 0) {
      await tx
        .insert(schema.containerAccountUsers)
        .values(userIds.map((userId) => ({ accountId: created.id, userId })))
    }
    return created
  })

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    isExternal: row.isExternal,
    boundUserIds: userIds,
    pushNotify,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function updateAccount(
  id: string,
  input: {
    name?: string
    kind?: AccountKind
    isExternal?: boolean
    userIds?: string[]
    pushNotify?: AccountPushNotify
  },
): Promise<AccountRow> {
  const existing = await getAccountById(id)
  if (!existing) throw new ContainerBusinessError('站点账户不存在', 404)
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    await assertNameAvailable(input.name, id)
  }
  const userIds = input.userIds === undefined ? null : await assertUsersExist(input.userIds)

  const row = await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.containerAccounts)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.isExternal === undefined ? {} : { isExternal: input.isExternal }),
        ...(input.pushNotify === undefined
          ? {}
          : { pushNotify: normalizeAccountPushNotify(input.pushNotify) }),
        updatedAt: new Date(),
      })
      .where(eq(schema.containerAccounts.id, id))
      .returning()
    if (userIds !== null) {
      await tx
        .delete(schema.containerAccountUsers)
        .where(eq(schema.containerAccountUsers.accountId, id))
      if (userIds.length > 0) {
        await tx
          .insert(schema.containerAccountUsers)
          .values(userIds.map((userId) => ({ accountId: id, userId })))
      }
    }
    return updated
  })

  const [withUsers] = await attachBoundUsers([row])
  return withUsers
}

/**
 * 删除前显式检查依赖并给出中文原因。
 * 台账与流转的外键是 RESTRICT，靠 FK 报错反推得到的是一句看不懂的英文。
 */
export async function deleteAccount(id: string): Promise<void> {
  const db = getDb()
  const existing = await getAccountById(id)
  if (!existing) throw new ContainerBusinessError('站点账户不存在', 404)

  const [balance] = await db
    .select({ n: count() })
    .from(schema.containerBalances)
    .where(eq(schema.containerBalances.accountId, id))
  if (balance.n > 0) {
    throw new ContainerBusinessError('该站点仍有容器台账记录，请先清理台账后再删除', 409)
  }

  const [transfer] = await db
    .select({ n: count() })
    .from(schema.containerTransfers)
    .where(
      sql`${schema.containerTransfers.fromAccountId} = ${id} OR ${schema.containerTransfers.toAccountId} = ${id}`,
    )
  if (transfer.n > 0) {
    throw new ContainerBusinessError('该站点已存在流转记录，不能删除', 409)
  }

  const [audit] = await db
    .select({ n: count() })
    .from(schema.containerBalanceAudits)
    .where(eq(schema.containerBalanceAudits.accountId, id))
  if (audit.n > 0) {
    throw new ContainerBusinessError('该站点存在台账变更审计，不能删除', 409)
  }

  await db.delete(schema.containerAccounts).where(eq(schema.containerAccounts.id, id))
}

export async function listAccountBoundUsers(accountId: string) {
  return getDb()
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      isActive: schema.users.isActive,
    })
    .from(schema.containerAccountUsers)
    .innerJoin(schema.users, eq(schema.users.id, schema.containerAccountUsers.userId))
    .where(eq(schema.containerAccountUsers.accountId, accountId))
    .orderBy(asc(schema.users.username))
}

/** 去重并校验用户存在，返回去重后的 id 列表 */
async function assertUsersExist(userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const found = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, unique))
  if (found.length !== unique.length) {
    throw new ContainerBusinessError('存在无效的用户 ID', 400)
  }
  return unique
}

/** 全量覆盖绑定关系 */
export async function replaceAccountBoundUsers(accountId: string, userIds: string[]): Promise<void> {
  const db = getDb()
  const existing = await getAccountById(accountId)
  if (!existing) throw new ContainerBusinessError('站点账户不存在', 404)

  const unique = await assertUsersExist(userIds)

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.containerAccountUsers)
      .where(eq(schema.containerAccountUsers.accountId, accountId))
    if (unique.length > 0) {
      await tx
        .insert(schema.containerAccountUsers)
        .values(unique.map((userId) => ({ accountId, userId })))
    }
  })
}

/** 站点账户页的用户下拉：系统内全部启用用户 */
export async function listAssignableUsers() {
  return getDb()
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(and(eq(schema.users.isActive, true)))
    .orderBy(asc(schema.users.username))
}
