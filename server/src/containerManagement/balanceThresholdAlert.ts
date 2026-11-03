/**
 * 容器管理：站点账户容器数量水位线告警（站点账户 × 品类）。
 *
 * 只在越界方向发生变化（正常→越界 / 越界→正常）时通知一次，持续越界不会每次台账变动都刷屏。
 * 推送复用账户已有的 pushNotify（chatId 群 + mentions），调用方在业务提交成功后 fire-and-forget，
 * 失败只记日志，不影响台账/流转主流程。
 */
import { and, eq, notInArray } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { ContainerBusinessError, getAccountById } from './accountService'
import { normalizeAccountPushNotify } from './pushNotify'
import { isKnownType, labelOf } from './containerTypeService'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { sendFeishuAppMessage } from '../feishu/feishuAppMessage'

export type ThresholdDirection = 'low' | 'high' | 'normal'

export type ThresholdRow = {
  accountId: string
  containerType: string
  minQty: number | null
  maxQty: number | null
  lastAlertDirection: ThresholdDirection | null
  lastAlertAt: string | null
}

export function resolveDirection(
  qty: number,
  minQty: number | null,
  maxQty: number | null,
): ThresholdDirection {
  if (minQty !== null && qty < minQty) return 'low'
  if (maxQty !== null && qty > maxQty) return 'high'
  return 'normal'
}

function toRow(row: typeof schema.containerBalanceThresholds.$inferSelect): ThresholdRow {
  return {
    accountId: row.accountId,
    containerType: row.containerType,
    minQty: row.minQty,
    maxQty: row.maxQty,
    lastAlertDirection: (row.lastAlertDirection as ThresholdDirection | null) ?? null,
    lastAlertAt: row.lastAlertAt ? row.lastAlertAt.toISOString() : null,
  }
}

export async function listThresholds(accountId: string): Promise<ThresholdRow[]> {
  const rows = await getDb()
    .select()
    .from(schema.containerBalanceThresholds)
    .where(eq(schema.containerBalanceThresholds.accountId, accountId))
  return rows.map(toRow)
}

/**
 * 全量覆盖一个账户的阈值配置；保存后立即用当前台账数量跑一次检查，不用等下一次台账变动。
 *
 * 未出现在 input 里的品类才删除，出现的品类按 (accountId, containerType) upsert——
 * 只改 minQty/maxQty，不碰 lastAlertDirection/lastAlertAt。
 * 否则「删全部再插全部」会把本次压根没改动的品类的告警状态一起清空，
 * 保存后的立即检查会把它当成「刚刚才越界」，对着同一个越界状态又推一条重复消息。
 */
export async function replaceThresholds(
  accountId: string,
  input: { containerType: string; minQty: number | null; maxQty: number | null }[],
): Promise<ThresholdRow[]> {
  if (!(await getAccountById(accountId))) {
    throw new ContainerBusinessError('站点账户不存在', 404)
  }
  for (const item of input) {
    if (!isKnownType(item.containerType)) {
      throw new ContainerBusinessError(`未知的容器品类：${item.containerType}`)
    }
    if (item.minQty !== null && (!Number.isInteger(item.minQty) || item.minQty < 0)) {
      throw new ContainerBusinessError('下限必须是非负整数')
    }
    if (item.maxQty !== null && (!Number.isInteger(item.maxQty) || item.maxQty < 0)) {
      throw new ContainerBusinessError('上限必须是非负整数')
    }
    if (item.minQty !== null && item.maxQty !== null && item.minQty > item.maxQty) {
      throw new ContainerBusinessError(`「${labelOf(item.containerType)}」下限不能大于上限`)
    }
  }
  const seen = new Set<string>()
  for (const item of input) {
    if (seen.has(item.containerType)) {
      throw new ContainerBusinessError(`「${labelOf(item.containerType)}」重复配置`)
    }
    seen.add(item.containerType)
  }

  const db = getDb()
  await db.transaction(async (tx) => {
    const keepTypes = input.map((item) => item.containerType)
    const removeWhere =
      keepTypes.length > 0
        ? and(
            eq(schema.containerBalanceThresholds.accountId, accountId),
            notInArray(schema.containerBalanceThresholds.containerType, keepTypes),
          )
        : eq(schema.containerBalanceThresholds.accountId, accountId)
    await tx.delete(schema.containerBalanceThresholds).where(removeWhere)

    for (const item of input) {
      await tx
        .insert(schema.containerBalanceThresholds)
        .values({
          accountId,
          containerType: item.containerType,
          minQty: item.minQty,
          maxQty: item.maxQty,
        })
        .onConflictDoUpdate({
          target: [
            schema.containerBalanceThresholds.accountId,
            schema.containerBalanceThresholds.containerType,
          ],
          set: { minQty: item.minQty, maxQty: item.maxQty, updatedAt: new Date() },
        })
    }
  })

  // 保存后用当前台账数量立即跑一次检查，不等下一次台账变动才发现已经越界
  for (const item of input) {
    if (item.minQty === null && item.maxQty === null) continue
    void checkAccountBalanceThreshold(accountId, item.containerType).catch((error) => {
      console.error('[container-balance-threshold] 保存配置后立即检查失败', error)
    })
  }

  return listThresholds(accountId)
}

/** 重新查一次当前台账数量再检查：用于「不知道确切新数量，只知道哪个账户哪个品类动过」的场景 */
async function checkAccountBalanceThreshold(accountId: string, containerType: string): Promise<void> {
  const [balance] = await getDb()
    .select({ quantity: schema.containerBalances.quantity })
    .from(schema.containerBalances)
    .where(
      and(
        eq(schema.containerBalances.accountId, accountId),
        eq(schema.containerBalances.containerType, containerType),
      ),
    )
    .limit(1)
  if (!balance) return
  await checkBalanceThreshold(accountId, containerType, balance.quantity)
}

/**
 * 流转确认/作废/差异结算都会改动双边台账，但改到多少不是这里关心的——重新查当前值即可。
 * 调用方在响应发出后 fire-and-forget，和 notifyTransferEvent 挂在同一批位置。
 */
export function checkTransferThresholds(transfer: {
  fromAccountId: string
  toAccountId: string
  items: { containerType: string }[]
}): void {
  const types = [...new Set(transfer.items.map((item) => item.containerType))]
  for (const accountId of [transfer.fromAccountId, transfer.toAccountId]) {
    for (const containerType of types) {
      void checkAccountBalanceThreshold(accountId, containerType).catch((error) => {
        console.error(`[container-balance-threshold] ${accountId}/${containerType} 检查异常`, error)
      })
    }
  }
}

/**
 * 核心入口：台账数量变化后调用。永不抛出。
 * 调用方应在业务提交成功之后调用（不要放在写台账的事务内部，避免飞书请求拖住事务）。
 *
 * 读阈值行、比较方向、写回状态三步锁在一个事务里（FOR UPDATE），
 * 否则同一账户同一品类的两次并发检查（比如一次批量导入里好几笔都动到同一个台账）
 * 会一起读到旧状态、一起判定"方向变了"、一起发消息，把只该提醒一次的事件发成好几条。
 */
export async function checkBalanceThreshold(
  accountId: string,
  containerType: string,
  quantity: number,
): Promise<void> {
  try {
    const db = getDb()
    const pending = await db.transaction(async (tx) => {
      const [threshold] = await tx
        .select()
        .from(schema.containerBalanceThresholds)
        .where(
          and(
            eq(schema.containerBalanceThresholds.accountId, accountId),
            eq(schema.containerBalanceThresholds.containerType, containerType),
          ),
        )
        .for('update')
        .limit(1)
      if (!threshold) return null
      if (threshold.minQty === null && threshold.maxQty === null) return null

      const direction = resolveDirection(quantity, threshold.minQty, threshold.maxQty)
      const prevDirection = (threshold.lastAlertDirection as ThresholdDirection | null) ?? 'normal'
      if (direction === prevDirection) return null

      await tx
        .update(schema.containerBalanceThresholds)
        .set({ lastAlertDirection: direction, lastAlertAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.containerBalanceThresholds.id, threshold.id))

      return { direction, minQty: threshold.minQty, maxQty: threshold.maxQty }
    })
    if (!pending || pending.direction === 'normal') return // 恢复正常不打扰群里，状态已在事务里更新

    await sendThresholdAlert(accountId, containerType, pending.direction, quantity, pending)
  } catch (error) {
    console.error(`[container-balance-threshold] ${accountId}/${containerType} 检查异常`, error)
  }
}

async function sendThresholdAlert(
  accountId: string,
  containerType: string,
  direction: 'low' | 'high',
  quantity: number,
  threshold: { minQty: number | null; maxQty: number | null },
): Promise<void> {
  const [account] = await getDb()
    .select({ name: schema.containerAccounts.name, pushNotify: schema.containerAccounts.pushNotify })
    .from(schema.containerAccounts)
    .where(eq(schema.containerAccounts.id, accountId))
    .limit(1)
  if (!account) return
  const pushNotify = normalizeAccountPushNotify(account.pushNotify)
  if (!pushNotify.enabled || !pushNotify.chatId) return

  const typeLabel = labelOf(containerType)
  const mentionPrefix = pushNotify.mentions
    .map((m) => `<at user_id="${m.openId}">${m.name || ''}</at>`)
    .join(' ')
  const body =
    direction === 'low'
      ? `【容器水位线告警】${account.name} 的${typeLabel}当前数量 ${quantity}，低于下限 ${threshold.minQty}，请及时补充容器`
      : `【容器水位线告警】${account.name} 的${typeLabel}当前数量 ${quantity}，高于上限 ${threshold.maxQty}，请及时前往该站点取回容器`
  const text = mentionPrefix ? `${mentionPrefix} ${body}` : body

  const tokenResult = await getFeishuTenantAccessToken()
  if (!tokenResult.ok) {
    console.error(`[container-balance-threshold] 获取飞书 tenant token 失败：${tokenResult.reason}`)
    return
  }
  const res = await sendFeishuAppMessage(tokenResult.token, pushNotify.chatId, 'text', { text }, 'chat_id')
  if (!res.ok) {
    console.error(`[container-balance-threshold] ${account.name}/${typeLabel} 群推送失败：${res.error}`)
  }
}
