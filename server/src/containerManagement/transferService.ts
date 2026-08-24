/**
 * 容器管理：流转记录状态机与库存记账。
 *
 * 数量的唯一真相源是 container_transfer_items：
 *   declaredQuantity 转出方申报 / receivedQuantity 接收方实收 / settledQuantity 最终落表
 *
 * 记账时对余额行加 FOR UPDATE 行锁再校验再扣减，并同步写台账审计，
 * 保证「谁拿了多少」与「怎么流的」在数据层是连通的。
 */
import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getDb, schema } from '../db'
import { ContainerBusinessError } from './accountService'
import { sumPendingOutbound, writeBalanceAudit } from './balanceService'
import {
  containerTypeLabel,
  transferKindNeedsReceiverConfirmation,
  type ContainerType,
  type TransferKind,
  type TransferStatus,
} from './constants'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

export type TransferLineInput = { containerType: ContainerType; quantity: number }

export type TransferItemView = {
  containerType: string
  declaredQuantity: number
  receivedQuantity: number | null
  settledQuantity: number | null
}

export type TransferView = {
  id: string
  kind: string
  status: string
  fromAccountId: string
  fromAccountName: string
  toAccountId: string
  toAccountName: string
  items: TransferItemView[]
  declaredTotal: number
  receivedTotal: number | null
  settledTotal: number | null
  imageUrl: string | null
  note: string | null
  receiverReportReason: string | null
  receiverReportImageUrl: string | null
  responseNote: string | null
  senderAcceptedAt: string | null
  respondedAt: string | null
  createdByUsername: string | null
  createdAt: string
}

const TRANSFER_ID_PREFIX = 'TR'

function labelOf(containerType: string): string {
  return containerTypeLabel[containerType as ContainerType] ?? containerType
}

async function generateTransferId(tx: Tx): Promise<string> {
  const rows = await tx.execute<{ seq: string }>(
    sql`SELECT nextval('container_transfer_id_seq')::text AS seq`,
  )
  const seq = rows[0]?.seq
  if (!seq) throw new Error('生成流转记录 ID 失败')
  return `${TRANSFER_ID_PREFIX}${seq.padStart(8, '0')}`
}

function normalizeLineItems(lineItems: TransferLineInput[]): TransferLineInput[] {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new ContainerBusinessError('至少需要一条流转明细')
  }
  const seen = new Set<string>()
  for (const item of lineItems) {
    if (seen.has(item.containerType)) {
      throw new ContainerBusinessError('同一流转记录中品类不能重复')
    }
    seen.add(item.containerType)
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ContainerBusinessError('数量必须为正整数')
    }
  }
  return lineItems
}

async function ensureBalanceRow(tx: Tx, accountId: string, containerType: string): Promise<void> {
  await tx
    .insert(schema.containerBalances)
    .values({ accountId, containerType, quantity: 0 })
    .onConflictDoNothing({
      target: [schema.containerBalances.accountId, schema.containerBalances.containerType],
    })
}

async function lockBalance(tx: Tx, accountId: string, containerType: string) {
  await ensureBalanceRow(tx, accountId, containerType)
  const rows = await tx
    .select()
    .from(schema.containerBalances)
    .where(
      and(
        eq(schema.containerBalances.accountId, accountId),
        eq(schema.containerBalances.containerType, containerType),
      ),
    )
    .for('update')
    .limit(1)
  return rows[0]
}

/**
 * 把一个品类的数量从转出方划到接收方，并写双边台账审计。
 * 转出方余额行先加行锁再校验，避免并发下双方各自读到足额而超扣。
 */
async function applyBalances(
  tx: Tx,
  params: {
    fromAccountId: string
    toAccountId: string
    containerType: string
    quantity: number
    transferId: string
    actorUserId: string | null
  },
): Promise<void> {
  const { fromAccountId, toAccountId, containerType, quantity, transferId, actorUserId } = params
  if (quantity <= 0) return

  // 固定按账户 id 排序加锁，避免两个反向流转互相等待造成死锁
  const [firstId, secondId] =
    fromAccountId < toAccountId ? [fromAccountId, toAccountId] : [toAccountId, fromAccountId]
  const firstRow = await lockBalance(tx, firstId, containerType)
  const secondRow = await lockBalance(tx, secondId, containerType)
  const fromRow = firstId === fromAccountId ? firstRow : secondRow
  const toRow = firstId === fromAccountId ? secondRow : firstRow

  if (fromRow.quantity < quantity) {
    throw new ContainerBusinessError(
      `转出方「${labelOf(containerType)}」余额不足：当前 ${fromRow.quantity}，需要 ${quantity}`,
    )
  }

  const fromNext = fromRow.quantity - quantity
  const toNext = toRow.quantity + quantity

  await tx
    .update(schema.containerBalances)
    .set({ quantity: fromNext, updatedAt: new Date() })
    .where(eq(schema.containerBalances.id, fromRow.id))
  await tx
    .update(schema.containerBalances)
    .set({ quantity: toNext, updatedAt: new Date() })
    .where(eq(schema.containerBalances.id, toRow.id))

  await writeBalanceAudit(tx, {
    action: 'TRANSFER',
    accountId: fromAccountId,
    containerType,
    prevQuantity: fromRow.quantity,
    newQuantity: fromNext,
    delta: -quantity,
    reasonType: 'TRANSFER_SETTLEMENT',
    reason: `流转 ${transferId} 转出`,
    transferId,
    actorUserId,
  })
  await writeBalanceAudit(tx, {
    action: 'TRANSFER',
    accountId: toAccountId,
    containerType,
    prevQuantity: toRow.quantity,
    newQuantity: toNext,
    delta: quantity,
    reasonType: 'TRANSFER_SETTLEMENT',
    reason: `流转 ${transferId} 转入`,
    transferId,
    actorUserId,
  })
}

/** 校验转出方可用量：在库数量减去已被待确认流转占用的数量 */
async function assertAvailable(
  tx: Tx,
  fromAccountId: string,
  lineItems: TransferLineInput[],
  excludeTransferId?: string,
): Promise<void> {
  for (const item of lineItems) {
    const balance = await lockBalance(tx, fromAccountId, item.containerType)
    const conditions = [
      eq(schema.containerTransfers.fromAccountId, fromAccountId),
      inArray(schema.containerTransfers.status, ['PENDING_RECEIVER', 'DISPUTED'] as TransferStatus[]),
      eq(schema.containerTransferItems.containerType, item.containerType),
    ]
    if (excludeTransferId) {
      conditions.push(sql`${schema.containerTransfers.id} <> ${excludeTransferId}`)
    }
    const [pendingRow] = await tx
      .select({
        total: sql<number>`coalesce(sum(${schema.containerTransferItems.declaredQuantity}), 0)::int`,
      })
      .from(schema.containerTransferItems)
      .innerJoin(
        schema.containerTransfers,
        eq(schema.containerTransfers.id, schema.containerTransferItems.transferId),
      )
      .where(and(...conditions))
    const available = balance.quantity - (pendingRow?.total ?? 0)
    if (available < item.quantity) {
      throw new ContainerBusinessError(
        `转出方「${labelOf(item.containerType)}」可用数量不足：可用 ${available}，需要 ${item.quantity}（已扣除待确认的流转）`,
      )
    }
  }
}

export async function createTransfer(input: {
  kind: TransferKind
  fromAccountId: string
  toAccountId: string
  lineItems: TransferLineInput[]
  imageUrl?: string | null
  note?: string | null
  actorUserId: string | null
}): Promise<string> {
  const lineItems = normalizeLineItems(input.lineItems)
  if (input.fromAccountId === input.toAccountId) {
    throw new ContainerBusinessError('转出方与接收方不能相同')
  }
  const accounts = await getDb()
    .select({ id: schema.containerAccounts.id })
    .from(schema.containerAccounts)
    .where(inArray(schema.containerAccounts.id, [input.fromAccountId, input.toAccountId]))
  if (accounts.length !== 2) throw new ContainerBusinessError('主体账户不存在', 404)

  const needsConfirm = transferKindNeedsReceiverConfirmation(input.kind)

  return getDb().transaction(async (tx) => {
    const transferId = await generateTransferId(tx)

    if (needsConfirm) {
      await assertAvailable(tx, input.fromAccountId, lineItems)
    }

    await tx.insert(schema.containerTransfers).values({
      id: transferId,
      kind: input.kind,
      status: needsConfirm ? 'PENDING_RECEIVER' : 'CONFIRMED',
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      imageUrl: input.imageUrl ?? null,
      note: input.note ?? null,
      respondedAt: needsConfirm ? null : new Date(),
      respondedBy: needsConfirm ? null : input.actorUserId,
      createdBy: input.actorUserId,
    })

    await tx.insert(schema.containerTransferItems).values(
      lineItems.map((item) => ({
        transferId,
        containerType: item.containerType,
        declaredQuantity: item.quantity,
        settledQuantity: needsConfirm ? null : item.quantity,
      })),
    )

    if (!needsConfirm) {
      for (const item of lineItems) {
        await applyBalances(tx, {
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          containerType: item.containerType,
          quantity: item.quantity,
          transferId,
          actorUserId: input.actorUserId,
        })
      }
    }

    return transferId
  })
}

async function loadTransferForUpdate(tx: Tx, transferId: string) {
  const rows = await tx
    .select()
    .from(schema.containerTransfers)
    .where(eq(schema.containerTransfers.id, transferId))
    .for('update')
    .limit(1)
  const transfer = rows[0]
  if (!transfer) throw new ContainerBusinessError('流转记录不存在', 404)
  const items = await tx
    .select()
    .from(schema.containerTransferItems)
    .where(eq(schema.containerTransferItems.transferId, transferId))
    .orderBy(asc(schema.containerTransferItems.containerType))
  return { transfer, items }
}

/** 无争议确认收货：按申报数量全额落表 */
export async function confirmTransfer(input: {
  transferId: string
  actorUserId: string | null
  responseNote?: string | null
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const { transfer, items } = await loadTransferForUpdate(tx, input.transferId)
    if (transfer.status !== 'PENDING_RECEIVER') {
      throw new ContainerBusinessError('仅待接收方确认的记录可确认收货')
    }
    for (const item of items) {
      await applyBalances(tx, {
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        containerType: item.containerType,
        quantity: item.declaredQuantity,
        transferId: transfer.id,
        actorUserId: input.actorUserId,
      })
      await tx
        .update(schema.containerTransferItems)
        .set({ settledQuantity: item.declaredQuantity })
        .where(eq(schema.containerTransferItems.id, item.id))
    }
    const note = input.responseNote?.trim()
    await tx
      .update(schema.containerTransfers)
      .set({
        status: 'CONFIRMED',
        responseNote: note ? note : null,
        respondedAt: new Date(),
        respondedBy: input.actorUserId,
      })
      .where(eq(schema.containerTransfers.id, transfer.id))
  })
}

function applyReceivedLineItems(
  items: { id: string; containerType: string; declaredQuantity: number }[],
  received: TransferLineInput[],
): Map<string, number> {
  const declaredMap = new Map(items.map((item) => [item.containerType, item.declaredQuantity]))
  const result = new Map<string, number>()
  for (const line of received) {
    const declared = declaredMap.get(line.containerType)
    if (declared === undefined) throw new ContainerBusinessError('申报明细包含不存在的品类')
    if (result.has(line.containerType)) throw new ContainerBusinessError('申报明细中品类不能重复')
    if (!Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > declared) {
      throw new ContainerBusinessError(
        `「${labelOf(line.containerType)}」的实收数量须为 0～${declared} 之间的整数`,
      )
    }
    result.set(line.containerType, line.quantity)
  }
  if (result.size !== declaredMap.size) {
    throw new ContainerBusinessError('请填写全部品类的实收数量')
  }
  return result
}

/** 差异/拒收申报：进入协商，不动库存 */
export async function reportReceipt(input: {
  transferId: string
  lineItems: TransferLineInput[]
  reason: string
  receiverReportImageUrl?: string | null
  isUpdate: boolean
}): Promise<void> {
  const reason = input.reason.trim()
  if (!reason) throw new ContainerBusinessError('请填写原因')

  await getDb().transaction(async (tx) => {
    const { transfer, items } = await loadTransferForUpdate(tx, input.transferId)
    const expected: TransferStatus = input.isUpdate ? 'DISPUTED' : 'PENDING_RECEIVER'
    if (transfer.status !== expected) {
      throw new ContainerBusinessError(
        input.isUpdate ? '仅协商中的记录可修改实收申报' : '仅待确认的记录可申报实收/拒收',
      )
    }
    const receivedMap = applyReceivedLineItems(items, input.lineItems)
    for (const item of items) {
      await tx
        .update(schema.containerTransferItems)
        .set({ receivedQuantity: receivedMap.get(item.containerType) ?? 0 })
        .where(eq(schema.containerTransferItems.id, item.id))
    }
    await tx
      .update(schema.containerTransfers)
      .set({
        status: 'DISPUTED',
        receiverReportReason: reason,
        ...(input.receiverReportImageUrl === undefined
          ? {}
          : { receiverReportImageUrl: input.receiverReportImageUrl }),
        ...(input.isUpdate
          ? {}
          : { responseNote: null, senderAcceptedAt: null, senderAcceptedBy: null }),
      })
      .where(eq(schema.containerTransfers.id, transfer.id))
  })
}

export async function addTransferMessage(input: {
  transferId: string
  actorUserId: string | null
  body: string
  proposedQuantity?: number | null
}): Promise<void> {
  const body = input.body.trim()
  if (!body) throw new ContainerBusinessError('留言不能为空')
  const db = getDb()
  const rows = await db
    .select({ status: schema.containerTransfers.status })
    .from(schema.containerTransfers)
    .where(eq(schema.containerTransfers.id, input.transferId))
    .limit(1)
  if (rows.length === 0) throw new ContainerBusinessError('流转记录不存在', 404)
  if (rows[0].status !== 'DISPUTED') throw new ContainerBusinessError('仅协商中的记录可留言')

  await db.insert(schema.containerTransferMessages).values({
    transferId: input.transferId,
    authorUserId: input.actorUserId,
    body,
    proposedQuantity:
      input.proposedQuantity !== undefined &&
      input.proposedQuantity !== null &&
      Number.isInteger(input.proposedQuantity)
        ? input.proposedQuantity
        : null,
  })
}

/** 转出方认可接收方申报的实收数量：按品类实收落表；全部为 0 则整单取消 */
export async function acceptSettlement(input: {
  transferId: string
  actorUserId: string | null
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const { transfer, items } = await loadTransferForUpdate(tx, input.transferId)
    if (transfer.status !== 'DISPUTED') {
      throw new ContainerBusinessError('仅协商中的记录可认可结算数量')
    }
    if (items.some((item) => item.receivedQuantity === null)) {
      throw new ContainerBusinessError('缺少接收方申报明细，请让接收方重新提交')
    }
    const total = items.reduce((sum, item) => sum + (item.receivedQuantity ?? 0), 0)
    const now = new Date()

    if (total === 0) {
      await tx
        .update(schema.containerTransfers)
        .set({
          status: 'CANCELLED',
          senderAcceptedAt: now,
          senderAcceptedBy: input.actorUserId,
          respondedAt: now,
          respondedBy: input.actorUserId,
        })
        .where(eq(schema.containerTransfers.id, transfer.id))
      return
    }

    for (const item of items) {
      const quantity = item.receivedQuantity ?? 0
      await applyBalances(tx, {
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        containerType: item.containerType,
        quantity,
        transferId: transfer.id,
        actorUserId: input.actorUserId,
      })
      await tx
        .update(schema.containerTransferItems)
        .set({ settledQuantity: quantity })
        .where(eq(schema.containerTransferItems.id, item.id))
    }

    await tx
      .update(schema.containerTransfers)
      .set({
        status: 'CONFIRMED',
        senderAcceptedAt: now,
        senderAcceptedBy: input.actorUserId,
        respondedAt: now,
        respondedBy: input.actorUserId,
      })
      .where(eq(schema.containerTransfers.id, transfer.id))
  })
}

function snapshotForChangeLog(
  transfer: typeof schema.containerTransfers.$inferSelect,
  items: (typeof schema.containerTransferItems.$inferSelect)[],
) {
  return {
    id: transfer.id,
    kind: transfer.kind,
    status: transfer.status,
    fromAccountId: transfer.fromAccountId,
    toAccountId: transfer.toAccountId,
    imageUrl: transfer.imageUrl,
    note: transfer.note,
    items: items.map((item) => ({
      containerType: item.containerType,
      declaredQuantity: item.declaredQuantity,
      receivedQuantity: item.receivedQuantity,
      settledQuantity: item.settledQuantity,
    })),
  }
}

export async function updateTransfer(input: {
  transferId: string
  lineItems?: TransferLineInput[]
  imageUrl?: string | null
  note?: string | null
  reason?: string
  actorUserId: string | null
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const { transfer, items } = await loadTransferForUpdate(tx, input.transferId)
    if (transfer.status === 'CONFIRMED' || transfer.status === 'CANCELLED') {
      throw new ContainerBusinessError('该状态不允许修改')
    }
    const before = snapshotForChangeLog(transfer, items)

    if (input.lineItems !== undefined) {
      if (transfer.status !== 'PENDING_RECEIVER') {
        throw new ContainerBusinessError('仅待接收方确认的记录可修改流转明细')
      }
      const lineItems = normalizeLineItems(input.lineItems)
      await assertAvailable(tx, transfer.fromAccountId, lineItems, transfer.id)
      await tx
        .delete(schema.containerTransferItems)
        .where(eq(schema.containerTransferItems.transferId, transfer.id))
      await tx.insert(schema.containerTransferItems).values(
        lineItems.map((item) => ({
          transferId: transfer.id,
          containerType: item.containerType,
          declaredQuantity: item.quantity,
        })),
      )
    }

    if (input.imageUrl !== undefined || input.note !== undefined) {
      await tx
        .update(schema.containerTransfers)
        .set({
          ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
          ...(input.note === undefined ? {} : { note: input.note }),
        })
        .where(eq(schema.containerTransfers.id, transfer.id))
    }

    const { transfer: after, items: afterItems } = await loadTransferForUpdate(tx, input.transferId)
    await tx.insert(schema.containerTransferChanges).values({
      transferId: transfer.id,
      action: 'UPDATE',
      reason: input.reason?.trim() ?? '',
      beforeData: before,
      afterData: snapshotForChangeLog(after, afterItems),
      actorUserId: input.actorUserId,
    })
  })
}

export async function deleteTransfer(input: {
  transferId: string
  reason: string
  actorUserId: string | null
}): Promise<void> {
  const reason = input.reason.trim()
  if (!reason) throw new ContainerBusinessError('请填写删除原因')

  await getDb().transaction(async (tx) => {
    const { transfer, items } = await loadTransferForUpdate(tx, input.transferId)
    if (transfer.status === 'CONFIRMED') {
      throw new ContainerBusinessError('已确认的记录不可删除')
    }
    await tx.insert(schema.containerTransferChanges).values({
      transferId: transfer.id,
      action: 'DELETE',
      reason,
      beforeData: snapshotForChangeLog(transfer, items),
      actorUserId: input.actorUserId,
    })
    // 审计的 transferId 是 ON DELETE SET NULL，快照仍保留在 beforeData 中
    await tx.delete(schema.containerTransfers).where(eq(schema.containerTransfers.id, transfer.id))
  })
}

function toTransferView(row: TransferRow, items: TransferItemView[]): TransferView {
  const declaredTotal = items.reduce((sum, item) => sum + item.declaredQuantity, 0)
  const hasReceived = items.some((item) => item.receivedQuantity !== null)
  const hasSettled = items.some((item) => item.settledQuantity !== null)
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    fromAccountId: row.fromAccountId,
    fromAccountName: row.fromAccountName,
    toAccountId: row.toAccountId,
    toAccountName: row.toAccountName,
    items,
    declaredTotal,
    receivedTotal: hasReceived
      ? items.reduce((sum, item) => sum + (item.receivedQuantity ?? 0), 0)
      : null,
    settledTotal: hasSettled
      ? items.reduce((sum, item) => sum + (item.settledQuantity ?? 0), 0)
      : null,
    imageUrl: row.imageUrl,
    note: row.note,
    receiverReportReason: row.receiverReportReason,
    receiverReportImageUrl: row.receiverReportImageUrl,
    responseNote: row.responseNote,
    senderAcceptedAt: row.senderAcceptedAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    createdByUsername: row.createdByUsername,
    createdAt: row.createdAt.toISOString(),
  }
}

const fromAccountTable = alias(schema.containerAccounts, 'from_account')
const toAccountTable = alias(schema.containerAccounts, 'to_account')
const creatorTable = alias(schema.users, 'transfer_creator')

type TransferRow = {
  id: string
  kind: string
  status: string
  fromAccountId: string
  fromAccountName: string
  toAccountId: string
  toAccountName: string
  imageUrl: string | null
  note: string | null
  receiverReportReason: string | null
  receiverReportImageUrl: string | null
  responseNote: string | null
  senderAcceptedAt: Date | null
  respondedAt: Date | null
  createdByUsername: string | null
  createdAt: Date
}

function transferSelectQuery(db: ReturnType<typeof getDb>) {
  return db
    .select({
      id: schema.containerTransfers.id,
      kind: schema.containerTransfers.kind,
      status: schema.containerTransfers.status,
      fromAccountId: schema.containerTransfers.fromAccountId,
      fromAccountName: fromAccountTable.name,
      toAccountId: schema.containerTransfers.toAccountId,
      toAccountName: toAccountTable.name,
      imageUrl: schema.containerTransfers.imageUrl,
      note: schema.containerTransfers.note,
      receiverReportReason: schema.containerTransfers.receiverReportReason,
      receiverReportImageUrl: schema.containerTransfers.receiverReportImageUrl,
      responseNote: schema.containerTransfers.responseNote,
      senderAcceptedAt: schema.containerTransfers.senderAcceptedAt,
      respondedAt: schema.containerTransfers.respondedAt,
      createdByUsername: creatorTable.username,
      createdAt: schema.containerTransfers.createdAt,
    })
    .from(schema.containerTransfers)
    .innerJoin(fromAccountTable, eq(fromAccountTable.id, schema.containerTransfers.fromAccountId))
    .innerJoin(toAccountTable, eq(toAccountTable.id, schema.containerTransfers.toAccountId))
    .leftJoin(creatorTable, eq(creatorTable.id, schema.containerTransfers.createdBy))
}

async function attachItems(rows: TransferRow[]): Promise<TransferView[]> {
  if (rows.length === 0) return []
  const items = await getDb()
    .select()
    .from(schema.containerTransferItems)
    .where(
      inArray(
        schema.containerTransferItems.transferId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.containerTransferItems.containerType))
  const byTransfer = new Map<string, TransferItemView[]>()
  for (const item of items) {
    const list = byTransfer.get(item.transferId) ?? []
    list.push({
      containerType: item.containerType,
      declaredQuantity: item.declaredQuantity,
      receivedQuantity: item.receivedQuantity,
      settledQuantity: item.settledQuantity,
    })
    byTransfer.set(item.transferId, list)
  }
  return rows.map((row) => toTransferView(row, byTransfer.get(row.id) ?? []))
}

export type TransferQuery = {
  visibleAccountIds: string[] | null
  transferId?: string
  fromAccountId?: string
  toAccountId?: string
  status?: TransferStatus
  start?: Date
  end?: Date
  page: number
  pageSize: number
}

export async function listTransfers(query: TransferQuery) {
  if (query.visibleAccountIds !== null && query.visibleAccountIds.length === 0) {
    return { items: [], total: 0 }
  }
  const db = getDb()
  const conditions = []
  if (query.visibleAccountIds !== null) {
    conditions.push(
      or(
        inArray(schema.containerTransfers.fromAccountId, query.visibleAccountIds),
        inArray(schema.containerTransfers.toAccountId, query.visibleAccountIds),
      ),
    )
  }
  if (query.fromAccountId) {
    conditions.push(eq(schema.containerTransfers.fromAccountId, query.fromAccountId))
  }
  if (query.toAccountId) conditions.push(eq(schema.containerTransfers.toAccountId, query.toAccountId))
  if (query.status) conditions.push(eq(schema.containerTransfers.status, query.status))
  if (query.start) conditions.push(gte(schema.containerTransfers.createdAt, query.start))
  if (query.end) conditions.push(lte(schema.containerTransfers.createdAt, query.end))
  if (query.transferId) {
    const raw = query.transferId.trim().toUpperCase()
    conditions.push(like(schema.containerTransfers.id, `${raw}%`))
  }
  const where = conditions.length ? and(...conditions) : undefined

  const [totalRow] = await db.select({ n: count() }).from(schema.containerTransfers).where(where)
  const rows = await transferSelectQuery(db)
    .where(where)
    .orderBy(desc(schema.containerTransfers.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)

  return { items: await attachItems(rows), total: totalRow?.n ?? 0 }
}

export async function getTransfer(transferId: string): Promise<TransferView | null> {
  const rows = await transferSelectQuery(getDb()).where(eq(schema.containerTransfers.id, transferId))
  const views = await attachItems(rows)
  return views[0] ?? null
}

export async function listTransferMessages(transferId: string) {
  const rows = await getDb()
    .select({
      id: schema.containerTransferMessages.id,
      body: schema.containerTransferMessages.body,
      proposedQuantity: schema.containerTransferMessages.proposedQuantity,
      authorUsername: schema.users.username,
      createdAt: schema.containerTransferMessages.createdAt,
    })
    .from(schema.containerTransferMessages)
    .leftJoin(schema.users, eq(schema.users.id, schema.containerTransferMessages.authorUserId))
    .where(eq(schema.containerTransferMessages.transferId, transferId))
    .orderBy(asc(schema.containerTransferMessages.createdAt))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export type TransferChangeQuery = {
  visibleAccountIds: string[] | null
  transferId?: string
  action?: string
  start?: Date
  end?: Date
  page: number
  pageSize: number
}

/**
 * 变更审计的可见性按关联流转判定；已删除的记录（transferId 为空）只有超管可见，
 * 避免在 jsonb 快照上做无索引的 path 查询。
 */
export async function listTransferChanges(query: TransferChangeQuery) {
  if (query.visibleAccountIds !== null && query.visibleAccountIds.length === 0) {
    return { items: [], total: 0 }
  }
  const db = getDb()
  const conditions = []
  if (query.visibleAccountIds !== null) {
    conditions.push(
      or(
        inArray(schema.containerTransfers.fromAccountId, query.visibleAccountIds),
        inArray(schema.containerTransfers.toAccountId, query.visibleAccountIds),
      ),
    )
  }
  if (query.transferId) {
    conditions.push(like(schema.containerTransferChanges.transferId, `${query.transferId.trim().toUpperCase()}%`))
  }
  if (query.action) conditions.push(eq(schema.containerTransferChanges.action, query.action))
  if (query.start) conditions.push(gte(schema.containerTransferChanges.createdAt, query.start))
  if (query.end) conditions.push(lte(schema.containerTransferChanges.createdAt, query.end))
  const where = conditions.length ? and(...conditions) : undefined

  const [totalRow] = await db
    .select({ n: count() })
    .from(schema.containerTransferChanges)
    .leftJoin(
      schema.containerTransfers,
      eq(schema.containerTransfers.id, schema.containerTransferChanges.transferId),
    )
    .where(where)

  const rows = await db
    .select({
      id: schema.containerTransferChanges.id,
      transferId: schema.containerTransferChanges.transferId,
      action: schema.containerTransferChanges.action,
      reason: schema.containerTransferChanges.reason,
      beforeData: schema.containerTransferChanges.beforeData,
      afterData: schema.containerTransferChanges.afterData,
      actorUsername: schema.users.username,
      createdAt: schema.containerTransferChanges.createdAt,
    })
    .from(schema.containerTransferChanges)
    .leftJoin(
      schema.containerTransfers,
      eq(schema.containerTransfers.id, schema.containerTransferChanges.transferId),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.containerTransferChanges.actorUserId))
    .where(where)
    .orderBy(desc(schema.containerTransferChanges.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize)

  return {
    items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total: totalRow?.n ?? 0,
  }
}

export { sumPendingOutbound }
