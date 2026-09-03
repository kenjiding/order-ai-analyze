/**
 * 容器管理：站点之间的容器净往来对账。
 *
 * 与容器台账是两本账：台账回答「我手上有多少框」，对账回答「谁欠我多少、我欠谁多少」。
 * 数据全部来自流转记录，不需要新表：
 *   - settled_quantity 是实际过账数量的唯一真相源（确认收货写申报量，认可结算写实收量）；
 *   - 已确认的流转不可改也不可删，所以聚合结果稳定，且与台账余额的变动一一对应；
 *   - 方向本身就是抵消关系（借出是我→他，归还是他→我），所以不看 kind，加新 kind 也不用改这里。
 *
 * 台账的手工调整（盘点、报废、损耗）不进双边往来 —— 对方把借去的框报废了，他仍然欠我。
 */
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { CONTAINER_TYPES } from './constants'

export type ReconciliationRow = {
  counterpartyId: string
  counterpartyName: string
  counterpartyKind: string
  containerType: string
  /** 已确认：我转出给对方的量 */
  outQty: number
  /** 已确认：对方转入给我的量 */
  inQty: number
  /** 在途：我已发出、等对方确认 */
  pendingOut: number
  /** 在途：对方已发出、等我确认 */
  pendingIn: number
}

/** net > 0 对方欠我，net < 0 我欠对方，net = 0 两清 */
export type ReconciliationNet = ReconciliationRow & { net: number }

export type ReconciliationSummary = {
  rows: ReconciliationNet[]
  /** 按品类合计对方欠我的量 */
  owedToMe: Record<string, number>
  /** 按品类合计我欠对方的量（正数） */
  owedByMe: Record<string, number>
}

/**
 * 纯函数：算净额并按品类分别汇总。
 * 在途量不参与加减 —— 对方随时可能拒收或报差异，算进净额会让数字回退，反而成为扯皮源头。
 */
export function summarizeReconciliation(rows: ReconciliationRow[]): ReconciliationSummary {
  // 两个方向都预置全品类，前端不用处理 undefined，也不会因为某品类没往来就少一列
  const owedToMe: Record<string, number> = Object.fromEntries(
    CONTAINER_TYPES.map((type) => [type, 0]),
  )
  const owedByMe: Record<string, number> = Object.fromEntries(
    CONTAINER_TYPES.map((type) => [type, 0]),
  )

  const withNet = rows.map((row) => {
    const net = row.outQty - row.inQty
    if (net > 0) owedToMe[row.containerType] = (owedToMe[row.containerType] ?? 0) + net
    else if (net < 0) owedByMe[row.containerType] = (owedByMe[row.containerType] ?? 0) - net
    return { ...row, net }
  })

  return { rows: withNet, owedToMe, owedByMe }
}

/** 以 accountId 为「我」，按对手方 × 品类聚合往来量 */
export async function listReconciliation(accountId: string): Promise<ReconciliationRow[]> {
  const t = schema.containerTransfers
  const i = schema.containerTransferItems
  const a = schema.containerAccounts

  /**
   * 对手方 = 这条流转里不是「我」的那一端。
   * 只用在 join 条件里：join 之后 a.id 就是对手方，select 与 group by 直接用 a.id。
   * 不能把这个表达式重复写进 select/group by —— Postgres 按语法匹配分组表达式，
   * 两处的 accountId 会渲染成不同的参数占位符（$1 / $12），会被判定成两个不同的表达式。
   */
  const counterparty = sql`case when ${t.fromAccountId} = ${accountId} then ${t.toAccountId} else ${t.fromAccountId} end`

  const rows = await getDb()
    .select({
      counterpartyId: a.id,
      counterpartyName: a.name,
      counterpartyKind: a.kind,
      containerType: i.containerType,
      outQty: sql<number>`coalesce(sum(case when ${t.status} = 'CONFIRMED' and ${t.fromAccountId} = ${accountId} then ${i.settledQuantity} end), 0)::int`,
      inQty: sql<number>`coalesce(sum(case when ${t.status} = 'CONFIRMED' and ${t.toAccountId} = ${accountId} then ${i.settledQuantity} end), 0)::int`,
      pendingOut: sql<number>`coalesce(sum(case when ${t.status} in ('PENDING_RECEIVER', 'DISPUTED') and ${t.fromAccountId} = ${accountId} then ${i.declaredQuantity} end), 0)::int`,
      pendingIn: sql<number>`coalesce(sum(case when ${t.status} in ('PENDING_RECEIVER', 'DISPUTED') and ${t.toAccountId} = ${accountId} then ${i.declaredQuantity} end), 0)::int`,
    })
    .from(t)
    .innerJoin(i, eq(i.transferId, t.id))
    .innerJoin(a, sql`${a.id} = ${counterparty}`)
    .where(
      and(
        or(eq(t.fromAccountId, accountId), eq(t.toAccountId, accountId)),
        // 已取消的不算账
        inArray(t.status, ['CONFIRMED', 'PENDING_RECEIVER', 'DISPUTED']),
      ),
    )
    .groupBy(a.id, a.name, a.kind, i.containerType)
    .orderBy(asc(a.name), asc(i.containerType))

  // 四个量全为 0 的（多品类流转里实收 0 的那个品类）没有展示价值。
  // 放在 JS 里过滤，比在 HAVING 里把四个聚合表达式再抄一遍干净。
  return rows.filter((row) => row.outQty || row.inQty || row.pendingOut || row.pendingIn)
}
