/**
 * 容器管理上线前演练：调用真实 service，把一个站点从建账到对账的完整生命周期跑一遍，
 * 每一步断言「台账余额」与「对账净额」应该是多少。
 *
 * 目的不是测试代码有没有崩，而是核对业务语义 —— 数字对不上的地方就是上线后会吵架的地方。
 * 用 [演练] 前缀的账户，跑完自动清理，不碰库里已有的数据。
 *
 * 跑：pnpm tsx src/containerManagement/rehearsal.ts
 */
import 'dotenv/config'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { closeDb, getDb, schema } from '../db'
import { createAccount } from './accountService'
import { createBalance, updateBalance } from './balanceService'
import {
  acceptSettlement,
  confirmTransfer,
  createTransfersBatch,
  reportReceipt,
  voidTransfer,
} from './transferService'
import {
  createContainerType,
  deleteContainerType,
  isActiveType,
  isKnownType,
  labelOf,
  listContainerTypes,
  updateContainerType,
  warmContainerTypeCache,
} from './containerTypeService'
import { listReconciliation, summarizeReconciliation } from './reconciliationService'

const PREFIX = '[演练]'
const SILVER = 'SILVER_BOX'

type Check = { step: string; what: string; expected: number; actual: number; note?: string }
const checks: Check[] = []
const notes: string[] = []

function expect(step: string, what: string, expected: number, actual: number, note?: string) {
  checks.push({ step, what, expected, actual, note })
}

async function balanceOf(accountId: string, type = SILVER): Promise<number> {
  const rows = await getDb()
    .select({ q: schema.containerBalances.quantity })
    .from(schema.containerBalances)
    .where(
      and(
        eq(schema.containerBalances.accountId, accountId),
        eq(schema.containerBalances.containerType, type),
      ),
    )
  return rows[0]?.q ?? 0
}

/** 某账户对某对手方在银筐上的对账净额；没有往来行时返回 0 */
async function netOf(accountId: string, counterpartyId: string): Promise<number> {
  const summary = summarizeReconciliation(await listReconciliation(accountId))
  const row = summary.rows.find(
    (r) => r.counterpartyId === counterpartyId && r.containerType === SILVER,
  )
  return row?.net ?? 0
}

async function pendingInOf(accountId: string, counterpartyId: string): Promise<number> {
  const rows = await listReconciliation(accountId)
  const row = rows.find((r) => r.counterpartyId === counterpartyId && r.containerType === SILVER)
  return row?.pendingIn ?? 0
}

/** 该账户台账流水里，按原因类型汇总的 delta 之和 */
async function auditSumByReason(accountId: string, reasonType: string): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`coalesce(sum(${schema.containerBalanceAudits.delta}), 0)::int` })
    .from(schema.containerBalanceAudits)
    .where(
      and(
        eq(schema.containerBalanceAudits.accountId, accountId),
        eq(schema.containerBalanceAudits.reasonType, reasonType),
      ),
    )
  return rows[0]?.n ?? 0
}

async function cleanup(): Promise<void> {
  const db = getDb()
  const accounts = await db
    .select({ id: schema.containerAccounts.id })
    .from(schema.containerAccounts)
    .where(like(schema.containerAccounts.name, `${PREFIX}%`))
  const ids = accounts.map((a) => a.id)
  if (ids.length === 0) return

  const transfers = await db
    .select({ id: schema.containerTransfers.id })
    .from(schema.containerTransfers)
    .where(
      sql`${schema.containerTransfers.fromAccountId} in ${ids} or ${schema.containerTransfers.toAccountId} in ${ids}`,
    )
  const transferIds = transfers.map((t) => t.id)

  // 审计对 accountId 是 RESTRICT，必须先清审计再删账户
  await db
    .delete(schema.containerBalanceAudits)
    .where(inArray(schema.containerBalanceAudits.accountId, ids))
  if (transferIds.length > 0) {
    await db
      .delete(schema.containerTransferChanges)
      .where(inArray(schema.containerTransferChanges.transferId, transferIds))
    // items 是 CASCADE，跟着 transfers 一起走
    await db.delete(schema.containerTransfers).where(inArray(schema.containerTransfers.id, transferIds))
  }
  await db.delete(schema.containerBalances).where(inArray(schema.containerBalances.accountId, ids))
  await db
    .delete(schema.containerAccountUsers)
    .where(inArray(schema.containerAccountUsers.accountId, ids))
  await db.delete(schema.containerAccounts).where(inArray(schema.containerAccounts.id, ids))
}

/**
 * 演练品类要在账户数据清干净之后再删，否则它还挂着引用删不掉。
 * 按名称匹配 —— 编码由后端自动生成，事先不知道是什么。
 */
async function cleanupRehearsalType(): Promise<void> {
  await getDb().delete(schema.containerTypes).where(like(schema.containerTypes.name, '演练托盘%'))
}

async function main() {
  // 这个脚本会建账户、记账、再删掉，只允许对本地库跑
  const url = process.env.DATABASE_URL ?? ''
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error('演练只能在本地库跑，当前 DATABASE_URL 不是 localhost')
  }

  await cleanup() // 上次跑残留的先清掉
  await cleanupRehearsalType()
  await warmContainerTypeCache()

  console.log('═'.repeat(72))
  console.log('容器管理 · 上线前演练')
  console.log('═'.repeat(72))

  // ── 建账 ────────────────────────────────────────────────────────────
  const B = await createAccount({ name: `${PREFIX}B站`, kind: 'INTERNAL_WAREHOUSE', createdBy: null })
  const A = await createAccount({ name: `${PREFIX}A站`, kind: 'INTERNAL_WAREHOUSE', createdBy: null })
  const C = await createAccount({
    name: `${PREFIX}C清关行`,
    kind: 'BROKER',
    isExternal: true,
    createdBy: null,
  })
  console.log(`\n建账完成：B站(内部) / A站(内部，新开站，零库存) / C清关行(外部)`)

  // ── Step 0：期初 ────────────────────────────────────────────────────
  // B 是老站，200 个银筐是自己的，走初始盘点合理；A 是新站，什么都不建
  await createBalance({ accountId: B.id, containerType: SILVER, quantity: 200, actorUserId: null })
  console.log('\n【Step 0】期初：B 站初始盘点 200 银筐，A 站不建任何台账')
  expect('Step 0', 'B 台账', 200, await balanceOf(B.id))
  expect('Step 0', 'A 台账', 0, await balanceOf(A.id))

  // ── Step 1：B 借 100 给 A ───────────────────────────────────────────
  const { ids: [t1] } = await createTransfersBatch(
    [{ kind: 'LEND', fromAccountId: B.id, toAccountId: A.id, lineItems: [{ containerType: SILVER, quantity: 100 }] }],
    null,
  )
  console.log('\n【Step 1】B 借 100 给 A —— 待 A 确认')
  expect('Step 1(待确认)', 'B 台账(未动)', 200, await balanceOf(B.id))
  expect('Step 1(待确认)', 'A 台账(未动)', 0, await balanceOf(A.id))
  expect('Step 1(待确认)', 'A 视角 net(在途不算)', 0, await netOf(A.id, B.id))
  expect('Step 1(待确认)', 'A 视角 在途转入', 100, await pendingInOf(A.id, B.id))

  await confirmTransfer({ transferId: t1, actorUserId: null })
  console.log('       A 确认收货 100')
  expect('Step 1(已确认)', 'B 台账', 100, await balanceOf(B.id))
  expect('Step 1(已确认)', 'A 台账', 100, await balanceOf(A.id))
  expect('Step 1(已确认)', 'A 视角 net(我欠B 100)', -100, await netOf(A.id, B.id))
  expect('Step 1(已确认)', 'B 视角 net(A欠我 100)', 100, await netOf(B.id, A.id))
  notes.push(
    'Step 1：A 手上有 100 个筐，同时欠 B 100 个 —— 台账与对账说的是两件事，两个数都对。',
  )

  // ── Step 2：A 归还 12 ───────────────────────────────────────────────
  const { ids: [t2] } = await createTransfersBatch(
    [{ kind: 'RETURN', fromAccountId: A.id, toAccountId: B.id, lineItems: [{ containerType: SILVER, quantity: 12 }] }],
    null,
  )
  await confirmTransfer({ transferId: t2, actorUserId: null })
  console.log('\n【Step 2】A 归还 12 给 B —— 这是你线上遇到方向反了的那一步')
  expect('Step 2', 'A 台账', 88, await balanceOf(A.id))
  expect('Step 2', 'B 台账', 112, await balanceOf(B.id))
  expect('Step 2', 'A 视角 net(我欠B 88)', -88, await netOf(A.id, B.id))
  notes.push(
    'Step 2：借出腿录进流转后，归还 12 得到 net=-88（我欠 B 88）。' +
      '线上之所以显示「B 欠我 12」，是因为 Step 1 那一腿走了期初盘点没进流转表。',
  )

  // ── Step 3：差异场景 —— B 发 50，A 只收到 45 ────────────────────────
  const { ids: [t3] } = await createTransfersBatch(
    [{ kind: 'LEND', fromAccountId: B.id, toAccountId: A.id, lineItems: [{ containerType: SILVER, quantity: 50 }] }],
    null,
  )
  await reportReceipt({
    transferId: t3,
    lineItems: [{ containerType: SILVER, quantity: 45 }],
    reason: '运输途中丢失 5 个',
    isUpdate: false,
  })
  await acceptSettlement({ transferId: t3, actorUserId: null })
  console.log('\n【Step 3】B 发 50，A 实收 45，B 认可结算 —— 途中丢了 5 个')
  // B 实物发走 50，账上就该少 50
  expect('Step 3', 'B 台账(发走50就该少50)', 112 - 50, await balanceOf(B.id), '差额=账面虚高的量')
  expect('Step 3', 'A 台账(实收45)', 133, await balanceOf(A.id))
  expect('Step 3', 'A 视角 net', -133, await netOf(A.id, B.id), 'A 不欠没收到的那 5 个')
  expect('Step 3', 'B 名下运输差异流水合计', -5, await auditSumByReason(B.id, 'TRANSIT_LOSS'), '丢的 5 个要有归属')
  notes.push(
    'Step 3：B 发 50 实收 45，B 台账减 50（不是 45），差的 5 个落成一条 TRANSIT_LOSS 挂在 B 名下，' +
      '带着 transferId —— 哪条线路、哪天、什么原因、谁认可的，全都查得到。',
  )

  // ── Step 4：A 报废 5 ────────────────────────────────────────────────
  const aBalRow = await getDb()
    .select({ id: schema.containerBalances.id, q: schema.containerBalances.quantity })
    .from(schema.containerBalances)
    .where(
      and(
        eq(schema.containerBalances.accountId, A.id),
        eq(schema.containerBalances.containerType, SILVER),
      ),
    )
  const aNow = aBalRow[0].q
  await updateBalance(aBalRow[0].id, {
    quantity: aNow - 5,
    reasonType: 'DAMAGE_SCRAP',
    reason: '演练：破损报废 5 个',
    actorUserId: null,
  })
  console.log('\n【Step 4】A 报废 5 个')
  expect('Step 4', 'A 台账', aNow - 5, await balanceOf(A.id))
  expect('Step 4', 'A 视角 net(报废不免除债务)', -133, await netOf(A.id, B.id))
  notes.push(
    `Step 4：A 手上 ${aNow - 5} 个，账上欠 133 个 —— 报废的 5 个没有任何单据能把它结清。`,
  )

  // ── Step 5：外部方代确认 ────────────────────────────────────────────
  const { ids: [t5] } = await createTransfersBatch(
    [{ kind: 'LEND', fromAccountId: A.id, toAccountId: C.id, lineItems: [{ containerType: SILVER, quantity: 30 }] }],
    null,
  )
  console.log('\n【Step 5】A 借 30 给 C 清关行，凭线下回单代确认')
  // 5a：故意不传回单，必须被拒
  let rejected = 0
  try {
    await confirmTransfer({ transferId: t5, actorUserId: null, proxy: true })
  } catch {
    rejected = 1
  }
  expect('Step 5', '无回单的代确认被拒绝(1=拒绝)', 1, rejected)
  // 5b：带上回单才放行
  await confirmTransfer({
    transferId: t5,
    actorUserId: null,
    proxy: true,
    proxyEvidenceUrl: 'https://example.invalid/演练回单.jpg',
  })
  const [t5row] = await getDb()
    .select({ proxy: schema.containerTransfers.proxyConfirmed, ev: schema.containerTransfers.proxyEvidenceUrl })
    .from(schema.containerTransfers)
    .where(eq(schema.containerTransfers.id, t5))
  expect('Step 5', '代确认成功(1=是)', 1, t5row.proxy ? 1 : 0)
  expect('Step 5', '回单已留存(1=有)', 1, t5row.ev ? 1 : 0)
  expect('Step 5', 'A 视角 对C net(C欠我30)', 30, await netOf(A.id, C.id))

  // ── Step 6：外部方余额转负 ──────────────────────────────────────────
  const { ids: [t6] } = await createTransfersBatch(
    [{ kind: 'RETURN', fromAccountId: C.id, toAccountId: A.id, lineItems: [{ containerType: SILVER, quantity: 40 }] }],
    null,
  )
  await confirmTransfer({ transferId: t6, actorUserId: null })
  console.log('\n【Step 6】C 只拿到 30 个，却还了 40 个给 A（外部方余额允许为负）')
  expect('Step 6', 'C 台账(设计上允许负数)', -10, await balanceOf(C.id))
  expect('Step 6', 'A 视角 对C net(我欠C 10)', -10, await netOf(A.id, C.id))
  notes.push('Step 6：外部方台账是推算量，可以为负 —— 统计「全网有多少筐」时不能把它直接加进去。')

  // ── Step 7：作废 Step 2 的归还 ──────────────────────────────────────
  const beforeVoidA = await balanceOf(A.id)
  const beforeVoidB = await balanceOf(B.id)
  await voidTransfer({ transferId: t2, reason: '演练：作废归还单', actorUserId: null })
  console.log('\n【Step 7】作废 Step 2 那笔已确认的归还 12')
  expect('Step 7', 'A 台账(冲回+12)', beforeVoidA + 12, await balanceOf(A.id))
  expect('Step 7', 'B 台账(冲回-12)', beforeVoidB - 12, await balanceOf(B.id))
  expect('Step 7', 'A 视角 net(归还退出计算)', -145, await netOf(A.id, B.id))

  // ── Step 8：作废一笔「有差异」的流转 ────────────────────────────────
  const beforeA8 = await balanceOf(A.id)
  const beforeB8 = await balanceOf(B.id)
  await voidTransfer({ transferId: t3, reason: '演练：作废带运输差异的流转', actorUserId: null })
  console.log('\n【Step 8】作废 Step 3 那笔「发 50 收 45」—— 验证途损能对称冲平')
  expect('Step 8', 'A 台账(吐回实收的45)', beforeA8 - 45, await balanceOf(A.id))
  expect('Step 8', 'B 台账(收回发出的50)', beforeB8 + 50, await balanceOf(B.id))
  expect('Step 8', 'B 名下运输差异净额归零', 0, await auditSumByReason(B.id, 'TRANSIT_LOSS'), '冲回后不留残值')
  expect('Step 8', 'A 视角 net(只剩最初那 100)', -100, await netOf(A.id, B.id))
  notes.push('Step 8：作废带差异的单，转出方连同途损一起收回，TRANSIT_LOSS 净额回到 0，不留残值。')

  // ── Step 9：新增品类能否无缝接进流转与对账 ─────────────────────────
  console.log('\n【Step 9】新增自定义品类，走一遍流转与对账')
  const created = await createContainerType({ name: '演练托盘' })
  const REHEARSAL_TYPE = created.code // 编码由后端自动生成
  expect('Step 9', '新品类默认启用(1=是)', 1, created.active ? 1 : 0)
  expect('Step 9', '新品类被认作可用品类(1=是)', 1, isActiveType(REHEARSAL_TYPE) ? 1 : 0)

  await createBalance({ accountId: B.id, containerType: REHEARSAL_TYPE, quantity: 60, actorUserId: null })
  const { ids: [t9] } = await createTransfersBatch(
    [{ kind: 'LEND', fromAccountId: B.id, toAccountId: A.id, lineItems: [{ containerType: REHEARSAL_TYPE, quantity: 20 }] }],
    null,
  )
  await reportReceipt({
    transferId: t9,
    lineItems: [{ containerType: REHEARSAL_TYPE, quantity: 18 }],
    reason: '演练：新品类途中少 2',
    isUpdate: false,
  })
  await acceptSettlement({ transferId: t9, actorUserId: null })
  expect('Step 9', 'B 新品类台账(发走20减20)', 40, await balanceOf(B.id, REHEARSAL_TYPE))
  expect('Step 9', 'A 新品类台账(实收18)', 18, await balanceOf(A.id, REHEARSAL_TYPE))
  expect('Step 9', '新品类也记运输差异', -2, await auditSumByReason(B.id, 'TRANSIT_LOSS'), '此前的差异已被 Step 8 冲平')

  const sum9 = summarizeReconciliation(await listReconciliation(A.id))
  const row9 = sum9.rows.find((r) => r.counterpartyId === B.id && r.containerType === REHEARSAL_TYPE)
  expect('Step 9', '对账认出新品类净额', -18, row9?.net ?? 0)
  expect('Step 9', '对账汇总带上新品类', 18, sum9.owedByMe[REHEARSAL_TYPE] ?? 0)

  let typeDeleteRejected = 0
  try {
    await deleteContainerType(REHEARSAL_TYPE)
  } catch {
    typeDeleteRejected = 1
  }
  expect('Step 9', '已有记录的品类禁止删除(1=拒绝)', 1, typeDeleteRejected)
  expect(
    'Step 9',
    '列表标记该品类已被引用(1=是)',
    1,
    (await listContainerTypes()).find((r) => r.code === REHEARSAL_TYPE)?.inUse ? 1 : 0,
  )

  await updateContainerType(REHEARSAL_TYPE, { active: false, name: '演练托盘(停用)' })
  expect('Step 9', '停用后不可再新建(0=不可)', 0, isActiveType(REHEARSAL_TYPE) ? 1 : 0)
  expect('Step 9', '停用后历史仍可查(1=可)', 1, isKnownType(REHEARSAL_TYPE) ? 1 : 0)
  expect('Step 9', '改名后显示名跟着变(1=是)', 1, labelOf(REHEARSAL_TYPE) === '演练托盘(停用)' ? 1 : 0)
  const sum9b = summarizeReconciliation(await listReconciliation(A.id))
  expect(
    'Step 9',
    '停用后对账仍算这笔账',
    -18,
    sum9b.rows.find((r) => r.counterpartyId === B.id && r.containerType === REHEARSAL_TYPE)?.net ?? 0,
  )
  notes.push(
    'Step 9：新品类不用改任何表结构就能走完流转、差异结算与对账；停用只挡新建，历史账照常结算。',
  )

  // ── 全貌 ────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72))
  console.log('最终台账')
  console.log('─'.repeat(72))
  for (const [name, id] of [['A站', A.id], ['B站', B.id], ['C清关行', C.id]] as const) {
    console.log(`  ${name.padEnd(10)} 银筐 ${String(await balanceOf(id)).padStart(5)}`)
  }

  console.log('\n' + '─'.repeat(72))
  console.log('最终对账（A 站视角）')
  console.log('─'.repeat(72))
  const summary = summarizeReconciliation(await listReconciliation(A.id))
  for (const r of summary.rows) {
    console.log(
      `  对手方 ${r.counterpartyName.replace(PREFIX, '').padEnd(8)} ` +
        `转出 ${String(r.outQty).padStart(4)}  转入 ${String(r.inQty).padStart(4)}  ` +
        `净额 ${String(r.net).padStart(5)}  ${r.net > 0 ? '对方欠我' : r.net < 0 ? '我欠对方' : '两清'}`,
    )
  }

  // ── 断言汇总 ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72))
  const failed = checks.filter((c) => c.expected !== c.actual)
  console.log(`断言：${checks.length} 条，通过 ${checks.length - failed.length}，偏差 ${failed.length}`)
  console.log('═'.repeat(72))
  if (failed.length > 0) {
    for (const f of failed) {
      console.log(`\n  ✗ ${f.step} · ${f.what}`)
      console.log(`      期望 ${f.expected}  实际 ${f.actual}${f.note ? `   （${f.note}）` : ''}`)
    }
  }

  console.log('\n' + '─'.repeat(72))
  console.log('演练观察')
  console.log('─'.repeat(72))
  for (const n of notes) console.log(`  · ${n}`)

  await cleanup()
  await cleanupRehearsalType()
  console.log('\n演练数据已清理。\n')
}

main()
  .catch((e) => {
    console.error('\n演练中断：', e instanceof Error ? e.message : e)
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup().catch(() => {})
    await cleanupRehearsalType().catch(() => {})
    await closeDb()
  })
