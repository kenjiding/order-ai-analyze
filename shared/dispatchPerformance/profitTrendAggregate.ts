/**
 * 出仓派签达成分析 · 利润稳定性：前后端共用的按天原始数据类型与聚合逻辑。
 *
 * 服务端只按 (到件日, 供应商, 路由码, 司机) 出未合桶的最细粒度原始行；三个维度
 * （供应商 / 路由码 / 司机）都从这份同一份原始行本地聚合出来，不用分别请求三次接口。
 * 司机维度按 courierCode 全局归并——同一司机在期间内可能换过供应商，甚至同一天为
 * 两家供应商跑车（A 供应商出不了货，借 B 供应商的司机），courierCode 才是这个人唯一的身份。
 * 天/周/月切换、出勤率与波动系数都在前端本地重算，不重新请求，做法同
 * shared/vendorRegionMap/trendPeriodAggregate.ts。
 */

export type DispatchProfitDailyRow = {
  arrivalDate: string
  supplierKey: string
  supplierName: string
  routeCode: string
  courierCode: string
  courierName: string
  vendorProfit: number
  courierProfit: number
  total: number
  pricedSignedCount: number
  unpricedSignedCount: number
}

export const PROFIT_TREND_GRANULARITIES = ['day', 'week', 'month'] as const
export type ProfitTrendGranularity = (typeof PROFIT_TREND_GRANULARITIES)[number]

/**
 * 三个分析维度。每个维度的「利润」口径不同，跟 PerformanceBreakdownTable 的既有约定一致
 * （供应商行只看 vendorProfit，司机行只看 courierProfit）：
 * - supplier：按供应商利润（公司从这家供应商身上赚的钱）排序
 * - route：路由码同样按供应商利润排序——路由的盈利能力是公司视角的问题
 * - courier：按司机利润（司机自己拿到手的钱）排序，回答「这个人赚得多不多、稳不稳」
 */
export const PROFIT_DIMENSIONS = ['supplier', 'route', 'courier'] as const
export type ProfitDimension = (typeof PROFIT_DIMENSIONS)[number]

export type ProfitEntityBucket = {
  bucket: string
  vendorProfit: number
  courierProfit: number
  total: number
}

export type ProfitEntitySummary = {
  /** supplierKey / routeCode / courierCode，作为 rowKey */
  key: string
  label: string
  /** 仅司机维度有意义：courierCode 展示在司机名下面 */
  courierCode?: string
  /** 期间内关联到的供应商；司机维度可能不止一家（借调/跳槽），供应商维度就是它自己 */
  supplierNames: string[]
  totalVendorProfit: number
  totalCourierProfit: number
  /** 排序/稳定性用的主指标：supplier、route 取 vendorProfit，courier 取 courierProfit */
  primaryProfit: number
  totalOrders: number
  /** 有产出的到件日天数，永远按天算，不受 granularity 影响 */
  attendanceDays: number
  /** attendanceDays / 站点在本区间内有任意结算数据的到件日总数，0~100 两位小数 */
  attendanceRate: number
  /** 出勤日里的日均主指标利润 = primaryProfit / attendanceDays */
  avgProfitPerDay: number
  /**
   * 出勤日里的日均司机利润 = totalCourierProfit / attendanceDays。
   * 司机维度下它就是 avgProfitPerDay（同一个数），单独给出主要是给路由码维度用——
   * 一条路由既要看公司在它身上赚多少（主指标 vendorProfit），也要看司机在它身上赚多少。
   */
  avgCourierProfitPerDay: number
  /**
   * 出勤日里主指标利润的变异系数（标准差 / 均值），越小越稳定。
   * 出勤天数 < 2 或均值 <= 0 时给 null —— 波动算不出意义，不能显示成 0（那是「完美稳定」的假象）。
   */
  cv: number | null
  /** 签收但未匹配到区域价格的件占比，0~100 两位小数；偏高说明这里的利润被低估了 */
  unpricedRatio: number
  /**
   * 出勤率 ≥80% 且 cv ≤0.3 且日均利润 >0 时为 true —— 默认阈值，仅供参考，
   * 具体标准由业务确认，不替业务下最终结论。
   */
  stable: boolean
  byBucket: ProfitEntityBucket[]
}

export type ProfitTrendResult = {
  dimension: ProfitDimension
  granularity: ProfitTrendGranularity
  buckets: string[]
  /** 区间内有任意结算数据的到件日总数，出勤率的分母 */
  totalStationDays: number
  entities: ProfitEntitySummary[]
}

/** 「稳定候选」判定阈值：默认先跑起来，后续要做成可调参数就从这里改 */
const STABLE_ATTENDANCE_RATE = 0.8
const STABLE_CV = 0.3

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? round2((numerator / denominator) * 100) : 0
}

/** 该日期所在 ISO 周（周一起始）的周一日期，纯字符串运算，不涉及时区。算法同 vendorRegionMap 的 mondayOfWeek */
function mondayOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const dow = utc.getUTCDay() // 0 = 周日 .. 6 = 周六
  utc.setUTCDate(utc.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`
}

function firstOfMonth(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

function bucketKeyOf(granularity: ProfitTrendGranularity): (date: string) => string {
  if (granularity === 'week') return mondayOfWeek
  if (granularity === 'month') return firstOfMonth
  return (date) => date
}

/** 该行在这个维度下的分组 key/展示名；司机维度顺带带出 courierCode 供表格副标题用 */
function entityIdentityOf(
  dimension: ProfitDimension,
  row: DispatchProfitDailyRow,
): { key: string; label: string; courierCode?: string } | null {
  if (dimension === 'supplier') {
    return { key: row.supplierKey, label: row.supplierName || row.supplierKey }
  }
  if (dimension === 'route') {
    // 路由码允许为空（未分配路由），仍是一个真实分组，不跳过——留空 key/label 让前端渲染「无路由码」
    return { key: row.routeCode, label: row.routeCode }
  }
  // courier 维度：空 courierCode = 未派件，不是真实司机，不参与统计（但仍计入下面的 totalStationDays）
  if (!row.courierCode) return null
  return { key: row.courierCode, label: row.courierName || row.courierCode, courierCode: row.courierCode }
}

/**
 * 按指定维度（供应商 / 路由码 / 司机）聚合出利润趋势与稳定性，从高到低排序。
 * 三个维度共用同一份原始行本地重算，纯函数，不碰数据库/网络。
 */
export function computeProfitTrend(
  rows: DispatchProfitDailyRow[],
  granularity: ProfitTrendGranularity,
  dimension: ProfitDimension,
): ProfitTrendResult {
  const totalStationDays = new Set(rows.map((r) => r.arrivalDate)).size
  const bucketKeyOfFn = bucketKeyOf(granularity)

  type EntityAcc = {
    label: string
    courierCode?: string
    supplierNames: Set<string>
    totalVendorProfit: number
    totalCourierProfit: number
    totalOrders: number
    /** arrivalDate -> 当日主指标利润，出勤天数与波动系数都从它算，不受 granularity 影响 */
    dailyPrimaryProfit: Map<string, number>
    pricedSignedCount: number
    unpricedSignedCount: number
    byBucket: Map<string, ProfitEntityBucket>
  }
  const entities = new Map<string, EntityAcc>()
  const primaryOf = (row: DispatchProfitDailyRow) =>
    dimension === 'courier' ? row.courierProfit : row.vendorProfit

  for (const row of rows) {
    const identity = entityIdentityOf(dimension, row)
    if (!identity) continue

    let acc = entities.get(identity.key)
    if (!acc) {
      acc = {
        label: identity.label,
        courierCode: identity.courierCode,
        supplierNames: new Set(),
        totalVendorProfit: 0,
        totalCourierProfit: 0,
        totalOrders: 0,
        dailyPrimaryProfit: new Map(),
        pricedSignedCount: 0,
        unpricedSignedCount: 0,
        byBucket: new Map(),
      }
      entities.set(identity.key, acc)
    }
    if (row.supplierName) acc.supplierNames.add(row.supplierName)
    acc.totalVendorProfit += row.vendorProfit
    acc.totalCourierProfit += row.courierProfit
    acc.totalOrders += row.total
    acc.pricedSignedCount += row.pricedSignedCount
    acc.unpricedSignedCount += row.unpricedSignedCount
    const primary = primaryOf(row)
    acc.dailyPrimaryProfit.set(row.arrivalDate, (acc.dailyPrimaryProfit.get(row.arrivalDate) ?? 0) + primary)

    const bucketKey = bucketKeyOfFn(row.arrivalDate)
    const bucket = acc.byBucket.get(bucketKey) ?? {
      bucket: bucketKey,
      vendorProfit: 0,
      courierProfit: 0,
      total: 0,
    }
    bucket.vendorProfit += row.vendorProfit
    bucket.courierProfit += row.courierProfit
    bucket.total += row.total
    acc.byBucket.set(bucketKey, bucket)
  }

  const summaries: ProfitEntitySummary[] = [...entities.entries()].map(([key, acc]) => {
    const dailyValues = [...acc.dailyPrimaryProfit.values()]
    const attendanceDays = dailyValues.length
    const primaryProfit = dimension === 'courier' ? acc.totalCourierProfit : acc.totalVendorProfit
    const mean = attendanceDays > 0 ? primaryProfit / attendanceDays : 0
    let cv: number | null = null
    if (attendanceDays >= 2 && mean > 0) {
      const variance = dailyValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / attendanceDays
      cv = round2(Math.sqrt(variance) / mean)
    }
    const attendanceRate = pct(attendanceDays, totalStationDays)
    return {
      key,
      label: acc.label,
      courierCode: acc.courierCode,
      supplierNames: [...acc.supplierNames].sort(),
      totalVendorProfit: round2(acc.totalVendorProfit),
      totalCourierProfit: round2(acc.totalCourierProfit),
      primaryProfit: round2(primaryProfit),
      totalOrders: acc.totalOrders,
      attendanceDays,
      attendanceRate,
      avgProfitPerDay: round2(mean),
      avgCourierProfitPerDay: attendanceDays > 0 ? round2(acc.totalCourierProfit / attendanceDays) : 0,
      cv,
      unpricedRatio: pct(acc.unpricedSignedCount, acc.pricedSignedCount + acc.unpricedSignedCount),
      stable: attendanceRate >= STABLE_ATTENDANCE_RATE * 100 && cv != null && cv <= STABLE_CV && mean > 0,
      byBucket: [...acc.byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    }
  })

  summaries.sort((a, b) => b.primaryProfit - a.primaryProfit)

  return {
    dimension,
    granularity,
    buckets: [...new Set(rows.map((r) => bucketKeyOfFn(r.arrivalDate)))].sort(),
    totalStationDays,
    entities: summaries,
  }
}
