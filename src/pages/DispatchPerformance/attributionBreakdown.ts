/**
 * 把「次日达成率」的未达成拆成两段可执行的原因。
 *
 * 后端只存了交叉的那一格（出仓准点 ∩ 次日达成），另外三格在这里由边际减出来：
 *   A 出仓准点 ∩ 次日达成 = crossMet
 *   B 出仓准点 ∩ 次日未达成 = before11Met − A   → 货准点给到了没派掉：司机/负载侧
 *   C 出仓晚   ∩ 次日达成   = nextDaySignMet − A → 出仓晚但司机赶回来了
 *   D 出仓晚   ∩ 次日未达成 = total − before11Met − nextDaySignMet + A → 连锁失败
 *
 * 「哪个因素最能影响」由 lift 回答：出仓准点组与出仓晚组的达成率之差（百分点）。
 * 这是观察性相关不是因果——出仓准点的单往往也落在好司机手上，两者混在一起。
 */

export type AttributionInput = {
  total: number
  /** 11 点前出仓达标数 */
  before11Met: number
  /** 次日派签达标数 */
  nextDaySignMet: number
  /** 出仓准点 ∩ 次日达成 的交叉计数 */
  crossMet: number
}

export type AttributionBreakdown = {
  total: number
  /** 四格，恒非负且之和 = total */
  exitMetSignMet: number
  exitMetSignUnmet: number
  exitUnmetSignMet: number
  exitUnmetSignUnmet: number
  /** 次日达成数与率（0~100，两位小数；total=0 时为 null） */
  met: number
  rate: number | null
  /** 出仓准点组 / 出仓晚组各自的次日达成率；样本为 0 时为 null */
  rateWhenExitMet: number | null
  rateWhenExitUnmet: number | null
  /** 杠杆：两组达成率之差，百分点。任一组为空时为 null */
  lift: number | null
  /**
   * 四格出现负数 = 交叉格与边际对不上，只可能是这条数据早于交叉列上线、没重跑过。
   * 此时整个拆解无意义，调用方必须显示「需重跑」而不是画一张错的图。
   */
  inconsistent: boolean
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 10000) / 100
}

export function buildAttribution(input: AttributionInput): AttributionBreakdown {
  const { total, before11Met, nextDaySignMet, crossMet } = input
  const exitMetSignMet = crossMet
  const exitMetSignUnmet = before11Met - crossMet
  const exitUnmetSignMet = nextDaySignMet - crossMet
  const exitUnmetSignUnmet = total - before11Met - nextDaySignMet + crossMet
  const exitUnmetTotal = total - before11Met

  return {
    total,
    exitMetSignMet,
    exitMetSignUnmet,
    exitUnmetSignMet,
    exitUnmetSignUnmet,
    met: nextDaySignMet,
    rate: pct(nextDaySignMet, total),
    rateWhenExitMet: pct(exitMetSignMet, before11Met),
    rateWhenExitUnmet: pct(exitUnmetSignMet, exitUnmetTotal),
    lift:
      before11Met > 0 && exitUnmetTotal > 0
        ? Math.round((pct(exitMetSignMet, before11Met)! - pct(exitUnmetSignMet, exitUnmetTotal)!) * 100) /
          100
        : null,
    inconsistent:
      exitMetSignUnmet < 0 || exitUnmetSignMet < 0 || exitUnmetSignUnmet < 0 || crossMet < 0,
  }
}
