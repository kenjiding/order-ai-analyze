/** 容器管理：容器台账 CRUD 与变更审计 */
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { ContainerBusinessError } from './accountService'
import {
  containerTypeLabel,
  PENDING_OUTBOUND_STATUSES,
  type BalanceAuditAction,
  type BalanceReasonType,
  type ContainerType,
} from './constants'

export type BalanceRow = {
  id: string
  accountId: string
  accountName: string
  accountKind: string
  containerType: string
  quantity: number
  updatedAt: string
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]
type Db = ReturnType<typeof getDb>

/**
 * 转出方某品类被「待接收方确认 / 协商中」的流转占用的数量。
 * 这部分库存已被承诺出去，不能再次借出，也不允许被手工调账抹掉。
 */
export async function sumPendingOutbound(
  db: Db | Tx,
  accountId: string,
  containerType?: ContainerType,
): Promise<number> {
  const conditions = [
    eq(schema.containerTransfers.fromAccountId, accountId),
    inArray(schema.containerTransfers.status, PENDING_OUTBOUND_STATUSES),
  ]
  if (containerType) {
    conditions.push(eq(schema.containerTransferItems.containerType, containerType))
  }
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.containerTransferItems.declaredQuantity}), 0)::int`,
    })
    .from(schema.containerTransferItems)
    .innerJoin(
      schema.containerTransfers,
      eq(schema.containerTransfers.id, schema.containerTransferItems.transferId),
    )
    .where(and(...conditions))
  return row?.total ?? 0
}

export async function listBalances(visibleAccountIds: string[] | null): Promise<BalanceRow[]> {
  if (visibleAccountIds !== null && visibleAccountIds.length === 0) return []
  const db = getDb()
  const query = db
    .select({
      id: schema.containerBalances.id,
      accountId: schema.containerBalances.accountId,
      accountName: schema.containerAccounts.name,
      accountKind: schema.containerAccounts.kind,
      containerType: schema.containerBalances.containerType,
      quantity: schema.containerBalances.quantity,
      updatedAt: schema.containerBalances.updatedAt,
    })
    .from(schema.containerBalances)
    .innerJoin(
      schema.containerAccounts,
      eq(schema.containerAccounts.id, schema.containerBalances.accountId),
    )
  const rows =
    visibleAccountIds === null
      ? await query.orderBy(asc(schema.containerAccounts.name), asc(schema.containerBalances.containerType))
      : await query
          .where(inArray(schema.containerBalances.accountId, visibleAccountIds))
          .orderBy(asc(schema.containerAccounts.name), asc(schema.containerBalances.containerType))
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}

export async function getBalanceById(id: string) {
  const rows = await getDb()
    .select()
    .from(schema.containerBalances)
    .where(eq(schema.containerBalances.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function writeBalanceAudit(
  tx: Db | Tx,
  input: {
    action: BalanceAuditAction
    accountId: string
    containerType: ContainerType | string
    prevQuantity: number | null
    newQuantity: number | null
    delta: number | null
    reasonType: BalanceReasonType
    reason?: string
    transferId?: number | null
    actorUserId: string | null
    actorIp?: string | null
  },
): Promise<void> {
  await tx.insert(schema.containerBalanceAudits).values({
    action: input.action,
    accountId: input.accountId,
    containerType: input.containerType,
    prevQuantity: input.prevQuantity,
    newQuantity: input.newQuantity,
    delta: input.delta,
    reasonType: input.reasonType,
    reason: input.reason ?? '',
    transferId: input.transferId ?? null,
    actorUserId: input.actorUserId,
    actorIp: input.actorIp ?? null,
  })
}

export async function createBalance(input: {
  accountId: string
  containerType: ContainerType
  quantity: number
  actorUserId: string | null
  actorIp?: string | null
}): Promise<BalanceRow> {
  const db = getDb()
  const account = await db
    .select({ id: schema.containerAccounts.id })
    .from(schema.containerAccounts)
    .where(eq(schema.containerAccounts.id, input.accountId))
    .limit(1)
  if (account.length === 0) throw new ContainerBusinessError('主体账户不存在', 404)

  const existing = await db
    .select({ id: schema.containerBalances.id })
    .from(schema.containerBalances)
    .where(
      and(
        eq(schema.containerBalances.accountId, input.accountId),
        eq(schema.containerBalances.containerType, input.containerType),
      ),
    )
    .limit(1)
  if (existing.length > 0) {
    throw new ContainerBusinessError('该主体在此品类下已有台账记录，请直接编辑', 409)
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.containerBalances)
      .values({
        accountId: input.accountId,
        containerType: input.containerType,
        quantity: input.quantity,
      })
      .returning()
    await writeBalanceAudit(tx, {
      action: 'CREATE',
      accountId: created.accountId,
      containerType: created.containerType,
      prevQuantity: null,
      newQuantity: created.quantity,
      delta: created.quantity,
      reasonType: 'INITIAL_STOCKTAKE',
      actorUserId: input.actorUserId,
      actorIp: input.actorIp,
    })
    return created
  })

  const [withAccount] = await listBalancesByIds([row.id])
  return withAccount
}

async function listBalancesByIds(ids: string[]): Promise<BalanceRow[]> {
  if (ids.length === 0) return []
  const rows = await getDb()
    .select({
      id: schema.containerBalances.id,
      accountId: schema.containerBalances.accountId,
      accountName: schema.containerAccounts.name,
      accountKind: schema.containerAccounts.kind,
      containerType: schema.containerBalances.containerType,
      quantity: schema.containerBalances.quantity,
      updatedAt: schema.containerBalances.updatedAt,
    })
    .from(schema.containerBalances)
    .innerJoin(
      schema.containerAccounts,
      eq(schema.containerAccounts.id, schema.containerBalances.accountId),
    )
    .where(inArray(schema.containerBalances.id, ids))
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}

export async function updateBalance(
  id: string,
  input: {
    quantity: number
    reasonType: BalanceReasonType
    reason: string
    actorUserId: string | null
    actorIp?: string | null
  },
): Promise<BalanceRow> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(schema.containerBalances)
      .where(eq(schema.containerBalances.id, id))
      .for('update')
      .limit(1)
    const existing = locked[0]
    if (!existing) throw new ContainerBusinessError('台账记录不存在', 404)

    // 调低到低于已承诺出去的数量，会让待确认的流转永远无法落表
    if (input.quantity < existing.quantity) {
      const pending = await sumPendingOutbound(
        tx,
        existing.accountId,
        existing.containerType as ContainerType,
      )
      if (input.quantity < pending) {
        throw new ContainerBusinessError(
          `「${containerTypeLabel[existing.containerType as ContainerType] ?? existing.containerType}」有 ${pending} 个已被待确认的流转占用，数量不能调低到 ${pending} 以下`,
        )
      }
    }

    await tx
      .update(schema.containerBalances)
      .set({ quantity: input.quantity, updatedAt: new Date() })
      .where(eq(schema.containerBalances.id, id))

    await writeBalanceAudit(tx, {
      action: 'UPDATE',
      accountId: existing.accountId,
      containerType: existing.containerType,
      prevQuantity: existing.quantity,
      newQuantity: input.quantity,
      delta: input.quantity - existing.quantity,
      reasonType: input.reasonType,
      reason: input.reason,
      actorUserId: input.actorUserId,
      actorIp: input.actorIp,
    })
  })
  const [row] = await listBalancesByIds([id])
  return row
}

export async function deleteBalance(
  id: string,
  input: {
    reasonType: BalanceReasonType
    reason: string
    actorUserId: string | null
    actorIp?: string | null
  },
): Promise<void> {
  const db = getDb()
  await db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(schema.containerBalances)
      .where(eq(schema.containerBalances.id, id))
      .for('update')
      .limit(1)
    const existing = locked[0]
    if (!existing) throw new ContainerBusinessError('台账记录不存在', 404)

    const pending = await sumPendingOutbound(
      tx,
      existing.accountId,
      existing.containerType as ContainerType,
    )
    if (pending > 0) {
      throw new ContainerBusinessError(
        `「${containerTypeLabel[existing.containerType as ContainerType] ?? existing.containerType}」有 ${pending} 个已被待确认的流转占用，不能删除台账`,
      )
    }

    await writeBalanceAudit(tx, {
      action: 'DELETE',
      accountId: existing.accountId,
      containerType: existing.containerType,
      prevQuantity: existing.quantity,
      newQuantity: null,
      delta: -existing.quantity,
      reasonType: input.reasonType,
      reason: input.reason,
      actorUserId: input.actorUserId,
      actorIp: input.actorIp,
    })
    await tx.delete(schema.containerBalances).where(eq(schema.containerBalances.id, id))
  })
}

export type BalanceAuditQuery = {
  visibleAccountIds: string[] | null
  accountId?: string
  containerType?: ContainerType
  reasonType?: string
  action?: string
  start?: Date
  end?: Date
  page: number
  pageSize: number
}

export async function listBalanceAudits(query: BalanceAuditQuery) {
  if (query.visibleAccountIds !== null && query.visibleAccountIds.length === 0) {
    return { items: [], total: 0 }
  }
  const db = getDb()
  const conditions = []
  if (query.visibleAccountIds !== null) {
    conditions.push(inArray(schema.containerBalanceAudits.accountId, query.visibleAccountIds))
  }
  if (query.accountId) conditions.push(eq(schema.containerBalanceAudits.accountId, query.accountId))
  if (query.containerType) {
    conditions.push(eq(schema.containerBalanceAudits.containerType, query.containerType))
  }
  if (query.reasonType) conditions.push(eq(schema.containerBalanceAudits.reasonType, query.reasonType))
  if (query.action) conditions.push(eq(schema.containerBalanceAudits.action, query.action))
  if (query.start) conditions.push(gte(schema.containerBalanceAudits.createdAt, query.start))
  if (query.end) conditions.push(lte(schema.containerBalanceAudits.createdAt, query.end))
  const where = conditions.length ? and(...conditions) : undefined

  const [totalRow] = await db
    .select({ n: count() })
    .from(schema.containerBalanceAudits)
    .where(where)

  const rows = await db
    .select({
      id: schema.containerBalanceAudits.id,
      action: schema.containerBalanceAudits.action,
      accountId: schema.containerBalanceAudits.accountId,
      accountName: schema.containerAccounts.name,
      containerType: schema.containerBalanceAudits.containerType,
      prevQuantity: schema.containerBalanceAudits.prevQuantity,
      newQuantity: schema.containerBalanceAudits.newQuantity,
      delta: schema.containerBalanceAudits.delta,
      reasonType: schema.containerBalanceAudits.reasonType,
      reason: schema.containerBalanceAudits.reason,
      transferId: schema.containerBalanceAudits.transferId,
      actorUsername: schema.users.username,
      createdAt: schema.containerBalanceAudits.createdAt,
    })
    .from(schema.containerBalanceAudits)
    .innerJoin(
      schema.containerAccounts,
      eq(schema.containerAccounts.id, schema.containerBalanceAudits.accountId),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.containerBalanceAudits.actorUserId))
    .where(where)
    .orderBy(desc(schema.containerBalanceAudits.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)

  return {
    items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total: totalRow?.n ?? 0,
  }
}
