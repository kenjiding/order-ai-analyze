/**
 * 供应商货量趋势 · 阶段二：脏数据剔除 + 按天/周合桶 + 峰谷/环比统计。
 *
 * 纯函数，只吃「已经匹配好供应商的按天计数」（VendorVolumeTrendRawResult），不碰原始扫描记录。
 * 服务端（server/src/vendorRegionMap/trendAggregate.ts）只做「阶段一」——匹配供应商、按天计数——
 * 拿到这份计数后，前端调整脏数据阈值或切换天/周维度时直接在本地调用 computeTrendView 重算，
 * 不需要重新请求接口。前后端共用同一份实现（shared/），口径不会跑偏。
 */

export type VendorTrendDailyPoint = {
  date: string
  supplierKey: string
  count: number
}

export type VendorTrendRoutePoint = {
  date: string
  supplierKey: string
  routeCode: string
  count: number
}

export type VendorTrendSupplierMeta = {
  supplierKey: string
  supplierName: string
  vendorCode: string
}

export type VendorTrendSupplier = {
  supplierKey: string
  supplierName: string
  vendorCode: string
  totalCount: number
  dailyAvg: number
  peakCount: number
  peakDate: string
  lowCount: number
  lowDate: string
  /** 环比：可比区间对半切，前半段日均/周均 */
  prevAvg: number
  /** 环比：可比区间对半切，后半段日均/周均 */
  recentAvg: number
  /** (recentAvg - prevAvg) / prevAvg；prevAvg 为 0 时为 null（区间内新增的供应商） */
  changeRate: number | null
  /** 区间内出现过的路由码数，作为运力规模的代理指标 */
  routeCodeCount: number
}

export type VendorVolumeTrendMeta = {
  startDate: string
  endDate: string
  days: number
  uniqueWaybills: number
  unmatchedNoVendor: number
  /** 拉取失败的日期：这些天不计入任何统计，必须在 UI 上显式标出 */
  failedDates: string[]
  /** 当天票量低于 dirtyThreshold 判定为脏数据的日期：同样不计入任何统计 */
  dirtyDates: string[]
  /** 判定脏数据的票量阈值（当天票量 < 此值即剔除） */
  dirtyThreshold: number
  /** 最后一个 period（今天所在的天/周）是否不完整，已被排除出环比计算 */
  lastDayPartial: boolean
  /** 实际参与环比计算的 period（已剔除失败日、脏数据日与不完整的最后一段） */
  comparableDates: string[]
}

export type VendorVolumeTrendPeriodResult = {
  /** 完整日期轴，不含拉取失败/脏数据的 period */
  dates: string[]
  suppliers: VendorTrendSupplier[]
  daily: VendorTrendDailyPoint[]
  routeDaily: VendorTrendRoutePoint[]
  meta: VendorVolumeTrendMeta
}

/** 服务端「阶段一」吐给前端的原始按天计数——不做脏数据剔除、不分天/周，前端拿这份自己算 */
export type VendorVolumeTrendRawResult = {
  /** 完整原始日期轴；只排除拉取失败的天，脏数据判定是前端的事，这里不剔除 */
  dates: string[]
  /**
   * date -> 当天去重后的真实票量，是脏数据判定的唯一依据。
   * 不能用 daily 里按供应商的计数求和代替——一票同时匹配多个供应商单位时，
   * 求和会比真实票量虚高，脏数据会判不准。
   */
  dayTotals: Record<string, number>
  daily: VendorTrendDailyPoint[]
  routeDaily: VendorTrendRoutePoint[]
  supplierMeta: VendorTrendSupplierMeta[]
  meta: {
    startDate: string
    endDate: string
    uniqueWaybills: number
    unmatchedNoVendor: number
    failedDates: string[]
    /** endDate 是今天时为 true；到底是哪一天/周不完整，由前端结合脏数据剔除结果决定 */
    lastDayPartial: boolean
  }
}

export const TREND_GRANULARITIES = ['day', 'week'] as const
export type TrendGranularity = (typeof TREND_GRANULARITIES)[number]

export type ComputeTrendViewInput = {
  raw: VendorVolumeTrendRawResult
  /** 当天票量低于这个数就判定为脏数据；0 = 不过滤 */
  dirtyThreshold: number
  granularity: TrendGranularity
}

export type TrendPeriodView = VendorVolumeTrendPeriodResult

function splitHalves(dates: string[]): { prev: string[]; recent: string[] } {
  if (dates.length < 2) return { prev: [], recent: [] }
  const mid = Math.floor(dates.length / 2)
  return { prev: dates.slice(0, mid), recent: dates.slice(mid) }
}

function averageOver(countByDate: Map<string, number>, dates: string[]): number {
  if (dates.length === 0) return 0
  let sum = 0
  for (const date of dates) sum += countByDate.get(date) ?? 0
  return sum / dates.length
}

/** 该日期所在 ISO 周（周一起始）的周一日期，纯字符串运算，不涉及时区 */
export function mondayOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const dow = utc.getUTCDay() // 0 = 周日 .. 6 = 周六
  utc.setUTCDate(utc.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`
}

/**
 * 剔除脏数据 + 按天/周合桶 + 算峰谷/环比。天/周走的是同一段代码：
 * 天视图的 dateKeyOf 是恒等函数（相当于不合桶），周视图才换成 mondayOfWeek。
 */
export function computeTrendView(input: ComputeTrendViewInput): TrendPeriodView {
  const { raw, dirtyThreshold, granularity } = input
  const rawLastDate = raw.dates[raw.dates.length - 1]

  const dirtySet = new Set(raw.dates.filter((date) => (raw.dayTotals[date] ?? 0) < dirtyThreshold))
  const dirtyDates = [...dirtySet].sort()
  const cleanDates = raw.dates.filter((date) => !dirtySet.has(date))
  const cleanDaily = raw.daily.filter((point) => !dirtySet.has(point.date))
  const cleanRouteDaily = raw.routeDaily.filter((point) => !dirtySet.has(point.date))

  // 「今天/本周不完整」只看剔除脏数据前的最后一天是否真的留在了轴上——
  // 如果它自己就是被判脏数据剔掉的那天，不能再去掉旁边另一天顶替
  const periodLastPartial = raw.meta.lastDayPartial && cleanDates[cleanDates.length - 1] === rawLastDate

  const dateKeyOf = granularity === 'week' ? mondayOfWeek : (date: string) => date
  const dates = [...new Set(cleanDates.map(dateKeyOf))].sort()

  // 服务端吐的是稠密网格（曾出现过的 supplierKey/routeCode 在每个原始日期都有一行，多数是 0）——
  // 0 计数的行必须跳过，不能让它们凭空注册出「从没真正发生过」的供应商/路由码 key，
  // 否则一个供应商只在被剔除的脏数据日出现过，也会带着 totalCount=0 混进 suppliers[]
  const dailyCounts = new Map<string, Map<string, number>>()
  for (const point of cleanDaily) {
    if (point.count <= 0) continue
    const key = dateKeyOf(point.date)
    const byDate = dailyCounts.get(point.supplierKey) ?? new Map<string, number>()
    byDate.set(key, (byDate.get(key) ?? 0) + point.count)
    dailyCounts.set(point.supplierKey, byDate)
  }
  const routeCounts = new Map<string, Map<string, Map<string, number>>>()
  for (const point of cleanRouteDaily) {
    if (point.count <= 0) continue
    const key = dateKeyOf(point.date)
    const byRoute = routeCounts.get(point.supplierKey) ?? new Map<string, Map<string, number>>()
    const byDate = byRoute.get(point.routeCode) ?? new Map<string, number>()
    byDate.set(key, (byDate.get(key) ?? 0) + point.count)
    byRoute.set(point.routeCode, byDate)
    routeCounts.set(point.supplierKey, byRoute)
  }

  const comparableDates = periodLastPartial && dates.length > 0 ? dates.slice(0, -1) : [...dates]
  const { prev, recent } = splitHalves(comparableDates)

  const metaByKey = new Map(raw.supplierMeta.map((meta) => [meta.supplierKey, meta]))

  const suppliers: VendorTrendSupplier[] = [...dailyCounts.entries()].map(([supplierKey, byDate]) => {
    let totalCount = 0
    let peakCount = -1
    let peakDate = ''
    let lowCount = Number.POSITIVE_INFINITY
    let lowDate = ''
    // 峰谷要看整条日期轴，没出现的 period 算 0 票（脏数据已经在上一步剔除了，这里的 0 是真的 0）
    for (const date of dates) {
      const count = byDate.get(date) ?? 0
      totalCount += count
      if (count > peakCount) {
        peakCount = count
        peakDate = date
      }
      if (count < lowCount) {
        lowCount = count
        lowDate = date
      }
    }

    const prevAvg = averageOver(byDate, prev)
    const recentAvg = averageOver(byDate, recent)
    const meta = metaByKey.get(supplierKey)

    return {
      supplierKey,
      supplierName: meta?.supplierName ?? '',
      vendorCode: meta?.vendorCode ?? '',
      totalCount,
      dailyAvg: dates.length > 0 ? totalCount / dates.length : 0,
      peakCount: peakCount < 0 ? 0 : peakCount,
      peakDate,
      lowCount: Number.isFinite(lowCount) ? lowCount : 0,
      lowDate,
      prevAvg,
      recentAvg,
      // 前半段一票没有 = 区间内新增的供应商，涨跌幅无意义（不能是 Infinity）
      changeRate: prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : null,
      routeCodeCount: routeCounts.get(supplierKey)?.size ?? 0,
    }
  })

  suppliers.sort((a, b) => b.totalCount - a.totalCount || a.supplierName.localeCompare(b.supplierName))

  const daily: VendorTrendDailyPoint[] = []
  for (const [supplierKey, byDate] of dailyCounts) {
    for (const date of dates) {
      daily.push({ date, supplierKey, count: byDate.get(date) ?? 0 })
    }
  }

  const routeDaily: VendorTrendRoutePoint[] = []
  for (const [supplierKey, byRoute] of routeCounts) {
    for (const [routeCode, byDate] of byRoute) {
      for (const date of dates) {
        routeDaily.push({ date, supplierKey, routeCode, count: byDate.get(date) ?? 0 })
      }
    }
  }

  return {
    dates,
    suppliers,
    daily,
    routeDaily,
    meta: {
      startDate: raw.meta.startDate,
      endDate: raw.meta.endDate,
      days: dates.length,
      uniqueWaybills: raw.meta.uniqueWaybills,
      unmatchedNoVendor: raw.meta.unmatchedNoVendor,
      failedDates: raw.meta.failedDates,
      dirtyDates,
      dirtyThreshold,
      lastDayPartial: periodLastPartial,
      comparableDates,
    },
  }
}
