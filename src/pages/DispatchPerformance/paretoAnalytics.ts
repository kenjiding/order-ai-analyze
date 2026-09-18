/**
 * 未达成单量的帕累托分解：把三层树按某一维度摊平，按未达成单量降序，给出累计占比。
 *
 * 为什么不是「杠杆排行」：把司机按达成率排序、再比较高低两组的达成率，是拿目标变量
 * 给自己排序又拿自己验证自己——纯噪声也能排出巨大的「影响」。集中度没有这个毛病：
 * 它比的是「实际分布」与「均匀分布」，且直接对应动作——
 *   Top 20% 占未达成 ≈ 20% → 全员问题，换人没用，要改流程；
 *   Top 20% 占未达成 70%   → 少数人/少数路由拖的，针对性处理收益最大。
 *
 * 白名单口径与后端一致：供应商层本就已剔除；路由层与司机层的 metrics 含白名单单量，
 * 所以整条落在白名单上的路由（及其司机）在这里直接跳过——它们不参与考核。
 */
import type {
  DispatchMetrics,
  DispatchSupplierNode,
} from './dispatchPerformanceTypes'

export type ParetoDimension = 'supplier' | 'route' | 'driver'
/** 看哪个指标的未达成：优先件次日完成 / 全量次日派签 */
export type ParetoMetric = 'priority' | 'nextDay'

export type ParetoItem = {
  key: string
  label: string
  /** 该项的未达成单量，图上的柱子 */
  unmet: number
  /** 分母：优先件口径是 priorityTotal，全量口径是 total */
  total: number
  /** 达成率 0~100，两位小数；total=0 时为 null */
  rate: number | null
  /** 累计未达成占比 0~100，图上的折线 */
  cumulativeShare: number
}

export type ParetoResult = {
  items: ParetoItem[]
  /** 全部项的未达成总量（含未进 Top N 的） */
  unmetTotal: number
  /** 参与排行的项数（含未进 Top N 的） */
  itemCount: number
  /** 前 20% 的项占了多少未达成，0~100；项数不足 5 个时为 null（算不出有意义的 20%） */
  top20Share: number | null
}

function metricOf(m: DispatchMetrics, metric: ParetoMetric): { total: number; met: number } {
  return metric === 'priority'
    ? { total: m.priorityTotal, met: m.priorityNextDaySignMet }
    : { total: m.total, met: m.nextDaySignMet }
}

/** 整条路由都落在白名单上 = 不参与考核，排行里不该出现 */
function fullyWhitelisted(total: number, whitelistTotal: number): boolean {
  return total > 0 && whitelistTotal >= total
}

type Raw = { key: string; label: string; metrics: DispatchMetrics }

function flatten(suppliers: DispatchSupplierNode[], dimension: ParetoDimension): Raw[] {
  if (dimension === 'supplier') {
    return suppliers.map((s) => ({ key: s.supplierKey, label: s.supplierName, metrics: s }))
  }

  const out: Raw[] = []
  for (const supplier of suppliers) {
    for (const route of supplier.routes) {
      if (fullyWhitelisted(route.total, route.whitelistTotal)) continue
      if (dimension === 'route') {
        out.push({
          key: `${supplier.supplierKey}\t${route.routeCode}`,
          label: route.routeCode || '（无路由码）',
          metrics: route,
        })
        continue
      }
      for (const driver of route.drivers) {
        if (!driver.courierCode) continue // 未派件的单没有司机可归，不进司机排行
        out.push({
          key: `${supplier.supplierKey}\t${driver.courierCode}`,
          label: driver.courierName || driver.courierCode,
          metrics: driver,
        })
      }
    }
  }

  // 同一个司机可能跑多条路由，按司机码合并，否则同一个人会在排行里出现好几次
  if (dimension !== 'driver') return out
  const merged = new Map<string, Raw & { agg: { total: number; met: number; priorityTotal: number; priorityMet: number } }>()
  for (const raw of out) {
    const existing = merged.get(raw.key)
    if (existing) {
      existing.agg.total += raw.metrics.total
      existing.agg.met += raw.metrics.nextDaySignMet
      existing.agg.priorityTotal += raw.metrics.priorityTotal
      existing.agg.priorityMet += raw.metrics.priorityNextDaySignMet
      continue
    }
    merged.set(raw.key, {
      ...raw,
      agg: {
        total: raw.metrics.total,
        met: raw.metrics.nextDaySignMet,
        priorityTotal: raw.metrics.priorityTotal,
        priorityMet: raw.metrics.priorityNextDaySignMet,
      },
    })
  }
  return [...merged.values()].map((m) => ({
    key: m.key,
    label: m.label,
    metrics: {
      ...m.metrics,
      total: m.agg.total,
      nextDaySignMet: m.agg.met,
      priorityTotal: m.agg.priorityTotal,
      priorityNextDaySignMet: m.agg.priorityMet,
    },
  }))
}

export function buildPareto(
  suppliers: DispatchSupplierNode[],
  dimension: ParetoDimension,
  metric: ParetoMetric,
  topN: number,
): ParetoResult {
  const scored = flatten(suppliers, dimension)
    .map((raw) => {
      const { total, met } = metricOf(raw.metrics, metric)
      return {
        key: raw.key,
        label: raw.label,
        total,
        unmet: Math.max(0, total - met),
        rate: total > 0 ? Math.round((met / total) * 10000) / 100 : null,
      }
    })
    .filter((item) => item.unmet > 0)
    .sort((a, b) => b.unmet - a.unmet || b.total - a.total || a.label.localeCompare(b.label))

  const unmetTotal = scored.reduce((sum, item) => sum + item.unmet, 0)

  // Top 20% 的口径：项数向上取整，不足 5 项时 20% 取不到一个有意义的切点
  const top20Share =
    scored.length >= 5 && unmetTotal > 0
      ? Math.round(
          (scored
            .slice(0, Math.ceil(scored.length * 0.2))
            .reduce((sum, item) => sum + item.unmet, 0) /
            unmetTotal) *
            1000,
        ) / 10
      : null

  let running = 0
  const items = scored.slice(0, topN).map((item) => {
    running += item.unmet
    return {
      ...item,
      cumulativeShare: unmetTotal > 0 ? Math.round((running / unmetTotal) * 1000) / 10 : 0,
    }
  })

  return { items, unmetTotal, itemCount: scored.length, top20Share }
}
