import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ, localDateTimeToMs } from '../imile/ausTimezone'
import {
  dispatchBatchSettleMs,
  exitBatchSettleMs,
  resolveDispatchDueArrivalDates,
  resolveExitDueArrivalDates,
  resolveExitSettledArrivalDates,
  resolveSettledArrivalDates,
} from './settledArrivalDates'

const tz = AUS_TZ.Adelaide

/** 该运行日 18:00（本地）跑结算任务时，回看窗口内全部已结算的到件日 */
function settledAt(runDate: string): string[] {
  const nowMs = localDateTimeToMs(`${runDate} 18:00:00`, tz)
  return resolveSettledArrivalDates(nowMs, tz, 8)
}

/** 该运行日新解锁的到件日：本次已结算、但前一天跑时还没结算 */
function newlySettledAt(runDate: string): string[] {
  const [y, m, d] = runDate.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  const before = new Set(settledAt(prev))
  return settledAt(runDate).filter((date) => !before.has(date))
}

// 2024-06-24(一) 25(二) 26(三) 27(四) 28(五) 29(六) 30(日) / 07-01(一) 02(二)
test('dispatchBatchSettleMs：滚动批次锚在出仓日11:00+24h，固定批次锚在下周一23:59:59', () => {
  // 周一到件 → 周二出仓 → 周三 11:00 全部到期
  assert.equal(dispatchBatchSettleMs('2024-06-24', tz), localDateTimeToMs('2024-06-26 11:00:00', tz))
  // 周四到件 → 周五出仓 → 周六 11:00 全部到期（不是下周一）
  assert.equal(dispatchBatchSettleMs('2024-06-27', tz), localDateTimeToMs('2024-06-29 11:00:00', tz))
  // 周五到件 → 周六出仓，但周日不派送 → 整批顺延到下周一 23:59:59
  assert.equal(dispatchBatchSettleMs('2024-06-28', tz), localDateTimeToMs('2024-07-01 23:59:59', tz))
})

test('resolveSettledArrivalDates：运行日新解锁的到件日 —— D→T 映射', () => {
  assert.deepEqual(newlySettledAt('2024-06-26'), ['2024-06-24']) // 周三 → 周一
  assert.deepEqual(newlySettledAt('2024-06-27'), ['2024-06-25']) // 周四 → 周二
  assert.deepEqual(newlySettledAt('2024-06-28'), ['2024-06-26']) // 周五 → 周三
  assert.deepEqual(newlySettledAt('2024-06-29'), ['2024-06-27']) // 周六 → 周四（不是下周二）
  assert.deepEqual(newlySettledAt('2024-06-30'), []) // 周日 → 无
  assert.deepEqual(newlySettledAt('2024-07-01'), []) // 周一 → 无
  // 周二 → 周五/周六/周日三批同时解锁
  assert.deepEqual(newlySettledAt('2024-07-02'), ['2024-06-28', '2024-06-29', '2024-06-30'])
})

test('resolveSettledArrivalDates：未到期的批次不会被提前纳入', () => {
  // 周一 07-01 18:00：周五~周日三批的截止是当天 23:59:59，尚未到期
  const monday = settledAt('2024-07-01')
  for (const d of ['2024-06-28', '2024-06-29', '2024-06-30']) assert.ok(!monday.includes(d), d)

  // 周三 06-26 18:00：周二那批要到周四 11:00 才到期
  assert.ok(!settledAt('2024-06-26').includes('2024-06-25'))
})

test('resolveSettledArrivalDates：结果升序且不含当天', () => {
  const dates = settledAt('2024-06-28')
  assert.deepEqual(dates, [...dates].sort())
  assert.ok(!dates.includes('2024-06-28'))
})

/** 出仓趟：该运行日 18:00 已解锁的到件日 */
function exitSettledAt(runDate: string): string[] {
  return resolveExitSettledArrivalDates(localDateTimeToMs(`${runDate} 18:00:00`, tz), tz, 8)
}

function newlyExitSettledAt(runDate: string): string[] {
  const [y, m, d] = runDate.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  const before = new Set(exitSettledAt(prev))
  return exitSettledAt(runDate).filter((date) => !before.has(date))
}

test('exitBatchSettleMs：出仓阈值即出仓日 11:00，出仓日恒为到件日次日', () => {
  // 周一到件 → 周二 11:00
  assert.equal(exitBatchSettleMs('2024-06-24', tz), localDateTimeToMs('2024-06-25 11:00:00', tz))
  // 周四到件 → 周五 11:00
  assert.equal(exitBatchSettleMs('2024-06-27', tz), localDateTimeToMs('2024-06-28 11:00:00', tz))
  // 周五到件 → 周六 11:00：周六不分拣，但照常出仓派送，不跳到下周一
  assert.equal(exitBatchSettleMs('2024-06-28', tz), localDateTimeToMs('2024-06-29 11:00:00', tz))
})

test('出仓趟比派签趟早一天解锁 —— 这一天的差正是两趟结算存在的原因', () => {
  assert.deepEqual(newlyExitSettledAt('2024-06-25'), ['2024-06-24']) // 周二 → 周一到件
  assert.deepEqual(newlyExitSettledAt('2024-06-26'), ['2024-06-25']) // 周三 → 周二到件
  assert.deepEqual(newlyExitSettledAt('2024-06-27'), ['2024-06-26']) // 周四 → 周三到件
  assert.deepEqual(newlyExitSettledAt('2024-06-28'), ['2024-06-27']) // 周五 → 周四到件
  assert.deepEqual(newlyExitSettledAt('2024-06-29'), ['2024-06-28']) // 周六 → 周五到件（周六照常出仓）

  // 同一个运行日：出仓结算「昨天」，派签结算「前天」
  const runDay = '2024-06-26' // 周三
  assert.deepEqual(newlyExitSettledAt(runDay), ['2024-06-25'], '出仓 = 昨天')
  assert.deepEqual(newlySettledAt(runDay), ['2024-06-24'], '派签 = 前天')
})

test('同一到件日的出仓阈值恒早于派签截止', () => {
  for (const d of ['2024-06-24', '2024-06-25', '2024-06-26', '2024-06-27', '2024-06-28']) {
    assert.ok(exitBatchSettleMs(d, tz) < dispatchBatchSettleMs(d, tz), d)
  }
})

/** 结算任务在该运行日 18:00 真正会去跑的到件日（只含刚到期的） */
function dispatchDueAt(runDate: string): string[] {
  return resolveDispatchDueArrivalDates(localDateTimeToMs(`${runDate} 18:00:00`, tz), tz, 8)
}

function exitDueAt(runDate: string): string[] {
  return resolveExitDueArrivalDates(localDateTimeToMs(`${runDate} 18:00:00`, tz), tz, 8)
}

test('Due 与 Settled 的差别：Settled 会一直带着旧批次，Due 只留刚到期的', () => {
  // 周五 18:00：回看窗口内一大票批次都早已到期，但只有周三那批是当天 11:00 才刚到期的
  const settled = settledAt('2024-06-28')
  assert.ok(settled.includes('2024-06-24') && settled.includes('2024-06-26'))
  assert.ok(settled.length > 3, `Settled 应带着多批历史，实际 ${settled.length} 批`)
  assert.deepEqual(dispatchDueAt('2024-06-28'), ['2024-06-26'])
  // Due 必须是 Settled 的子集：只是少了不回补的那些，不能凭空多出批次
  for (const date of dispatchDueAt('2024-06-28')) assert.ok(settled.includes(date), date)
})

test('每个到件日恰好在到期后的第一次运行里进入 Due，之后不再出现', () => {
  const runDays = [
    '2024-06-25', '2024-06-26', '2024-06-27', '2024-06-28',
    '2024-06-29', '2024-06-30', '2024-07-01', '2024-07-02', '2024-07-03',
  ]
  for (const [label, dueAt, newlyAt] of [
    ['dispatch', dispatchDueAt, newlySettledAt],
    ['exit', exitDueAt, newlyExitSettledAt],
  ] as const) {
    const seen = new Map<string, string[]>()
    for (const runDay of runDays) {
      // Due 必须等于「这一天新解锁的批次」——不多（不回补）也不少（不漏跑）
      assert.deepEqual(dueAt(runDay), newlyAt(runDay), `${label} @ ${runDay}`)
      for (const date of dueAt(runDay)) {
        seen.set(date, [...(seen.get(date) ?? []), runDay])
      }
    }
    for (const [date, runs] of seen) {
      assert.equal(runs.length, 1, `${label} 到件日 ${date} 被 Due 命中 ${runs.length} 次: ${runs}`)
    }
  }
})

test('漏跑一天不会在次日被回补 —— 过期即弃', () => {
  // 周三到件的派签批次周五 11:00 到期。周五 18:00 是唯一的结算机会
  assert.ok(dispatchDueAt('2024-06-28').includes('2024-06-26'))
  // 周六 18:00 已过 26h 窗口，不再纳入；但 Settled 仍认为它「已到期」，供前端标注用
  assert.ok(!dispatchDueAt('2024-06-29').includes('2024-06-26'))
  assert.ok(settledAt('2024-06-29').includes('2024-06-26'))
})

test('新站点首次启用只拿刚到期的那一批，不回补历史', () => {
  // 台账为空时 pending = settledAt(全部)，但真正会跑的只有 Due 这一两批
  const runDay = '2024-06-27' // 周四
  assert.ok(settledAt(runDay).length > 1, '已到期的批次不止一批')
  assert.deepEqual(dispatchDueAt(runDay), ['2024-06-25'])
  assert.deepEqual(exitDueAt(runDay), ['2024-06-26'])
})

test('同一次运行里，同一个到件日不会同时落进两趟的 Due', () => {
  for (const runDay of ['2024-06-25', '2024-06-26', '2024-06-27', '2024-06-28', '2024-06-29', '2024-07-01', '2024-07-02']) {
    const both = dispatchDueAt(runDay).filter((d) => exitDueAt(runDay).includes(d))
    assert.deepEqual(both, [], `${runDay} 两趟 Due 重叠: ${both}`)
  }
})
