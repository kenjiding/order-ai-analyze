/** 容器管理：主体账户 CRUD 与用户绑定 */
import { and, asc, count, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AccountKind } from './constants'

export type AccountRow = {
  id: string
  name: string
  kind: string
  boundUserIds: string[]
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

async function attachBoundUsers(rows: { id: string; name: string; kind: string; createdAt: Date }[]): Promise<AccountRow[]> {
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
    boundUserIds: byAccount.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
  }))
}

/**
 * @param visibleAccountIds null 表示不限（超管）
 * @param counterparty true 时返回可见范围之外的账户，供流转「接收方」下拉使用
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
      createdAt: schema.containerAccounts.createdAt,
    })
    .from(schema.containerAccounts)

  if (visibleAccountIds === null) {
    return attachBoundUsers(await base.orderBy(asc(schema.containerAccounts.name)))
  }
  if (counterparty) {
    const rows = visibleAccountIds.length
      ? await base
          .where(notInArray(schema.containerAccounts.id, visibleAccountIds))
          .orderBy(asc(schema.containerAccounts.name))
      : await base.orderBy(asc(schema.containerAccounts.name))
    return attachBoundUsers(rows)
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
    throw new ContainerBusinessError('已存在同名主体账户', 409)
  }
}

export async function createAccount(input: {
  name: string
  kind: AccountKind
  createdBy: string | null
}): Promise<AccountRow> {
  await assertNameAvailable(input.name)
  const [row] = await getDb()
    .insert(schema.containerAccounts)
    .values({ name: input.name, kind: input.kind, createdBy: input.createdBy })
    .returning()
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    boundUserIds: [],
    createdAt: row.createdAt.toISOString(),
  }
}

export async function updateAccount(
  id: string,
  input: { name?: string; kind?: AccountKind },
): Promise<AccountRow> {
  const existing = await getAccountById(id)
  if (!existing) throw new ContainerBusinessError('主体账户不存在', 404)
  if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
    await assertNameAvailable(input.name, id)
  }
  const [row] = await getDb()
    .update(schema.containerAccounts)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      updatedAt: new Date(),
    })
    .where(eq(schema.containerAccounts.id, id))
    .returning()
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
  if (!existing) throw new ContainerBusinessError('主体账户不存在', 404)

  const [balance] = await db
    .select({ n: count() })
    .from(schema.containerBalances)
    .where(eq(schema.containerBalances.accountId, id))
  if (balance.n > 0) {
    throw new ContainerBusinessError('该主体仍有容器台账记录，请先清理台账后再删除', 409)
  }

  const [transfer] = await db
    .select({ n: count() })
    .from(schema.containerTransfers)
    .where(
      sql`${schema.containerTransfers.fromAccountId} = ${id} OR ${schema.containerTransfers.toAccountId} = ${id}`,
    )
  if (transfer.n > 0) {
    throw new ContainerBusinessError('该主体已存在流转记录，不能删除', 409)
  }

  const [audit] = await db
    .select({ n: count() })
    .from(schema.containerBalanceAudits)
    .where(eq(schema.containerBalanceAudits.accountId, id))
  if (audit.n > 0) {
    throw new ContainerBusinessError('该主体存在台账变更审计，不能删除', 409)
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

/** 全量覆盖绑定关系 */
export async function replaceAccountBoundUsers(accountId: string, userIds: string[]): Promise<void> {
  const db = getDb()
  const existing = await getAccountById(accountId)
  if (!existing) throw new ContainerBusinessError('主体账户不存在', 404)

  const unique = [...new Set(userIds)]
  if (unique.length > 0) {
    const found = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.id, unique))
    if (found.length !== unique.length) {
      throw new ContainerBusinessError('存在无效的用户 ID', 400)
    }
  }

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

/** 主体账户页的用户下拉：系统内全部启用用户 */
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
