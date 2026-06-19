import dayjs, { type Dayjs } from 'dayjs'
import {
  readWaybillDriverCode,
  readWaybillDriverName,
  readWaybillNo,
  readWaybillRouteCode,
  readWaybillVendor,
  type WaybillRecord,
} from './waybillFieldMap'

export type { WaybillRecord } from './waybillFieldMap'

export type KpiSummary = {
  totalCount: number
  signedCount: number
  signRate: number | null
  /** 已派送单数：有合法 deliveryTime 的记录数（24h 签收率的分母） */
  dispatchedCount: number
  within24hCount: number
  within24hRate: number | null
  /** firstDsArriveDate 有值的单数及其占总货量的比例 */
  dsArriveCount: number
  dsArriveRate: number | null
  melbourne2D: { matched: number; subsetTotal: number; rate: number | null }
  sydney3D: { matched: number; subsetTotal: number; rate: number | null }
}

/** 区间桶：1D = (0,1] / 2D = (1,2] / 3D = (2,3] / 4D = (3,4] / >4D = (4,∞) */
export type TransitBucketLabel = '1D' | '2D' | '3D' | '4D' | '>4D'
export type TransitBucket = {
  label: TransitBucketLabel
  count: number
  percent: number
}

const TRANSIT_LABELS: TransitBucketLabel[] = ['1D', '2D', '3D', '4D', '>4D']
const MELBOURNE = 'melbournecenter'
const SYDNEY = 'sydneycenter'
const INVALID_DATE_STRINGS = new Set(['null', 'undefined', 'nan', 'none', '-', ''])

function readField(record: WaybillRecord, key: string): string {
  const v = record[key]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function parseDate(raw: string): Dayjs | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (INVALID_DATE_STRINGS.has(lower)) return null
  /** "0000-00-00 …" 是常见 SQL 空时间占位，直接判空 */
  if (raw.startsWith('0000')) return null
  let d = dayjs(raw, 'YYYY-MM-DD HH:mm:ss', true)
  if (d.isValid()) return d
  d = dayjs(raw, 'YYYY-MM-DD', true)
  if (d.isValid()) return d
  d = dayjs(raw)
  return d.isValid() ? d : null
}

function isSigned(rec: WaybillRecord): boolean {
  return parseDate(readField(rec, 'signDate')) !== null
}

function diffHours(a: Dayjs, b: Dayjs): number {
  return a.diff(b, 'hour', true)
}

function diffDays(a: Dayjs, b: Dayjs): number {
  return a.diff(b, 'day', true)
}

/**
 * 守卫式比较：仅当 `a - b` 落在 `[0, max]` 时才视为达标。
 * 负数差异（数据倒挂，例如 signDate < firstCountryDate）一律不计入分子，
 * 避免脏数据被错算成达标。
 */
function withinHoursPositive(a: Dayjs | null, b: Dayjs | null, maxHours: number): boolean {
  if (!a || !b) return false
  const d = diffHours(a, b)
  return Number.isFinite(d) && d >= 0 && d <= maxHours
}

function withinDaysPositive(a: Dayjs | null, b: Dayjs | null, maxDays: number): boolean {
  if (!a || !b) return false
  const d = diffDays(a, b)
  return Number.isFinite(d) && d >= 0 && d <= maxDays
}

/** 周一=1 …… 周五=5 …… 周六=6 …… 周日=0（dayjs 默认） */
const FRIDAY = 5
const SATURDAY = 6

function isFriday(d: Dayjs): boolean {
  return d.day() === FRIDAY
}

function isSaturday(d: Dayjs): boolean {
  return d.day() === SATURDAY
}

function leqEndOfDay(signDate: Dayjs, base: Dayjs, dayOffset: number): boolean {
  /** base + dayOffset 天的当天 23:59:59.999；signDate 落在该截止时间内则达标 */
  const deadline = base.add(dayOffset, 'day').endOf('day')
  return signDate.valueOf() >= base.valueOf() && signDate.valueOf() <= deadline.valueOf()
}

/**
 * 24h 签收率 — 周末感知：
 *   - 若 deliveryTime 是周五且 ≥ 16:00，截止时间顺延到下周一 23:59:59（+3 天）
 *   - 若 deliveryTime 是周六（全天），截止时间顺延到下周一 23:59:59（+2 天）
 *   - 其他场景：默认 signDate − deliveryTime ∈ [0, 24h]
 */
function isWithin24hWithWeekend(signDate: Dayjs | null, deliveryTime: Dayjs | null): boolean {
  if (!signDate || !deliveryTime) return false
  if (isFriday(deliveryTime) && deliveryTime.hour() >= 16) {
    return leqEndOfDay(signDate, deliveryTime, 3)
  }
  if (isSaturday(deliveryTime)) {
    return leqEndOfDay(signDate, deliveryTime, 2)
  }
  return withinHoursPositive(signDate, deliveryTime, 24)
}

/**
 * 2D 签收（Melbourne）— 周末感知：
 *   - 若 firstCountryDate 是周五，截止时间顺延到下周二 23:59:59
 *   - 其他场景：默认 signDate − firstCountryDate ∈ [0, 2d]
 */
function isWithin2DWithWeekend(signDate: Dayjs | null, firstCountryDate: Dayjs | null): boolean {
  if (!signDate || !firstCountryDate) return false
  if (isFriday(firstCountryDate)) {
    /** Fri(5) → Tue(2)：+4 天 */
    return leqEndOfDay(signDate, firstCountryDate, 4)
  }
  return withinDaysPositive(signDate, firstCountryDate, 2)
}

/**
 * 3D 签收（Sydney）— 周末感知：
 *   - 若 firstCountryDate 是周五，截止时间顺延到下周三 23:59:59
 *   - 其他场景：默认 signDate − firstCountryDate ∈ [0, 3d]
 */
function isWithin3DWithWeekend(signDate: Dayjs | null, firstCountryDate: Dayjs | null): boolean {
  if (!signDate || !firstCountryDate) return false
  if (isFriday(firstCountryDate)) {
    /** Fri(5) → Wed(3)：+5 天 */
    return leqEndOfDay(signDate, firstCountryDate, 5)
  }
  return withinDaysPositive(signDate, firstCountryDate, 3)
}

function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

/**
 * 把 actualReceiveStation 归一化为无空白小写串，避免 "Melbourne Center" / "Melbourne  Center" / "melbourne_center" 失配
 */
function normalizeStation(rec: WaybillRecord): string {
  return readField(rec, 'actualReceiveStation')
    .toLowerCase()
    .replace(/[\s_\-]+/g, '')
}

/**
 * 计算核心 KPI。
 *
 * 公式（与用户决策一致）：
 * - 总货量 = records.length
 * - 已签收 = 能解析出有效 signDate 的单数
 * - 签收率 = 已签收 / 总货量
 * - 24h 签收率 = (已签收 且 signDate − deliveryTime ∈ [0, 24h]) / 有 deliveryTime 的记录数
 *   分母只统计已派送（deliveryTime 合法）的单；signDate 为空则视作签收时间无穷大，不计入分子
 * - Melbourne·2D 率 = (Melbourne子集 且 已签收 且 signDate − firstCountryDate ∈ [0, 2d]) / Melbourne子集总数
 * - Sydney·3D 率   = (Sydney  子集 且 已签收 且 signDate − firstCountryDate ∈ [0, 3d]) / Sydney  子集总数
 *
 * 周末感知（仅对 24h / 2D / 3D 生效）：
 *   - 若 deliveryTime 是周五且 ≥ 16:00，24h 截止时间顺延到下周一 23:59:59
 *   - 若 firstCountryDate 是周五，2D 截止时间顺延到下周二 23:59:59、3D 顺延到下周三 23:59:59
 *   - 其他场景维持原始 24h / 2d / 3d 浮点阈值
 *
 * 负数差（signDate 早于参考时间，数据倒挂）一律不计入分子。
 */
export function computeKpis(records: WaybillRecord[]): KpiSummary {
  let signedCount = 0
  let dispatchedCount = 0
  let within24hCount = 0
  let dsArriveCount = 0

  let melbourneSubsetTotal = 0
  let sydneySubsetTotal = 0
  let melbourneMatched = 0
  let sydneyMatched = 0

  for (const rec of records) {
    const signDate = parseDate(readField(rec, 'signDate'))
    const deliveryTime = parseDate(readField(rec, 'deliveryTime'))
    const firstCountry = parseDate(readField(rec, 'firstCountryDate'))
    const firstDsArrive = parseDate(readField(rec, 'firstDsArriveDate'))
    const signed = signDate !== null

    if (signed) signedCount += 1
    if (deliveryTime) {
      dispatchedCount += 1
      if (signed && isWithin24hWithWeekend(signDate, deliveryTime)) {
        within24hCount += 1
      }
    }
    if (firstDsArrive) dsArriveCount += 1

    const station = normalizeStation(rec)
    if (station === MELBOURNE) {
      melbourneSubsetTotal += 1
      if (signed && isWithin2DWithWeekend(signDate, firstCountry)) {
        melbourneMatched += 1
      }
    } else if (station === SYDNEY) {
      sydneySubsetTotal += 1
      if (signed && isWithin3DWithWeekend(signDate, firstCountry)) {
        sydneyMatched += 1
      }
    }
  }

  const totalCount = records.length
  return {
    totalCount,
    signedCount,
    signRate: safeRate(signedCount, totalCount),
    dispatchedCount,
    within24hCount,
    within24hRate: safeRate(within24hCount, dispatchedCount),
    dsArriveCount,
    dsArriveRate: safeRate(dsArriveCount, totalCount),
    melbourne2D: {
      matched: melbourneMatched,
      subsetTotal: melbourneSubsetTotal,
      rate: safeRate(melbourneMatched, melbourneSubsetTotal),
    },
    sydney3D: {
      matched: sydneyMatched,
      subsetTotal: sydneySubsetTotal,
      rate: safeRate(sydneyMatched, sydneySubsetTotal),
    },
  }
}

/**
 * 转运时间分布：以 `firstDsArriveDate − firstCountryDate` 的浮点天数分桶，
 * 桶语义为开区间：1D=(0,1] / 2D=(1,2] / 3D=(2,3] / 4D=(3,4] / >4D=(4,∞)。
 * 负数差与缺字段单一律剔除（不计入分母 validTotal）。
 */
export function computeTransitDistribution(records: WaybillRecord[]): TransitBucket[] {
  const counts = new Map<TransitBucketLabel, number>()
  for (const label of TRANSIT_LABELS) counts.set(label, 0)

  let validTotal = 0
  for (const rec of records) {
    const firstDsArrive = parseDate(readField(rec, 'firstDsArriveDate'))
    const firstCountry = parseDate(readField(rec, 'firstCountryDate'))
    if (!firstDsArrive || !firstCountry) continue
    const days = diffDays(firstDsArrive, firstCountry)
    if (!Number.isFinite(days) || days < 0) continue

    validTotal += 1
    if (days <= 1) counts.set('1D', (counts.get('1D') ?? 0) + 1)
    else if (days <= 2) counts.set('2D', (counts.get('2D') ?? 0) + 1)
    else if (days <= 3) counts.set('3D', (counts.get('3D') ?? 0) + 1)
    else if (days <= 4) counts.set('4D', (counts.get('4D') ?? 0) + 1)
    else counts.set('>4D', (counts.get('>4D') ?? 0) + 1)
  }

  return TRANSIT_LABELS.map((label) => {
    const count = counts.get(label) ?? 0
    return {
      label,
      count,
      percent: validTotal > 0 ? (count / validTotal) * 100 : 0,
    }
  })
}

export function formatPercent(rate: number | null, digits = 1): string {
  if (rate === null || !Number.isFinite(rate)) return '--'
  return `${(rate * 100).toFixed(digits)}%`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatDays(days: number | null, digits = 2): string {
  if (days === null || !Number.isFinite(days)) return '--'
  return `${days.toFixed(digits)} D`
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export type RouteCodeThresholds = {
  minVolume: number
  minSignRate: number
  minWithin24hRate: number
  maxMedianTransitDays: number
}

export const DEFAULT_ROUTE_CODE_THRESHOLDS: RouteCodeThresholds = {
  minVolume: 10,
  minSignRate: 0.95,
  minWithin24hRate: 0.6,
  maxMedianTransitDays: 3,
}

export type RouteCodeStatus = 'ok' | 'warning' | 'bad' | 'insufficient'

export type RouteCodeRow = {
  routeCode: string
  volume: number
  signedCount: number
  signRate: number | null
  /** 该路由码下已派送（有合法 deliveryTime）的单数 = 24h 率分母 */
  dispatchedCount: number
  within24hCount: number
  within24hRate: number | null
  medianTransitDays: number | null
  medianSignDays: number | null
  dominantStation: 'melbourne' | 'sydney' | null
  stationRate: number | null
  topVendor: string | null
  violations: string[]
  status: RouteCodeStatus
}

const STATUS_RANK: Record<RouteCodeStatus, number> = {
  bad: 0,
  warning: 1,
  ok: 2,
  insufficient: 3,
}

function readRouteCode(rec: WaybillRecord): string {
  return readWaybillRouteCode(rec)
}

function readVendor(rec: WaybillRecord): string {
  return readWaybillVendor(rec)
}

function pickDominantStation(records: WaybillRecord[]): {
  station: 'melbourne' | 'sydney' | null
  share: number
} {
  if (!records.length) return { station: null, share: 0 }
  let melbourne = 0
  let sydney = 0
  for (const rec of records) {
    const s = normalizeStation(rec)
    if (s === MELBOURNE) melbourne += 1
    else if (s === SYDNEY) sydney += 1
  }
  const total = records.length
  const melbourneShare = melbourne / total
  const sydneyShare = sydney / total
  if (melbourneShare >= 0.7) return { station: 'melbourne', share: melbourneShare }
  if (sydneyShare >= 0.7) return { station: 'sydney', share: sydneyShare }
  return { station: null, share: 0 }
}

function computeRouteCodeRow(
  routeCode: string,
  records: WaybillRecord[],
  thresholds: RouteCodeThresholds,
): RouteCodeRow {
  let signedCount = 0
  let dispatchedCount = 0
  let within24hCount = 0
  const transitDays: number[] = []
  const signDays: number[] = []

  for (const rec of records) {
    const signDate = parseDate(readField(rec, 'signDate'))
    const deliveryTime = parseDate(readField(rec, 'deliveryTime'))
    const firstDsArrive = parseDate(readField(rec, 'firstDsArriveDate'))
    const firstCountry = parseDate(readField(rec, 'firstCountryDate'))
    const signed = signDate !== null
    if (signed) signedCount += 1

    if (deliveryTime) {
      dispatchedCount += 1
      if (signed && isWithin24hWithWeekend(signDate, deliveryTime)) {
        within24hCount += 1
      }
    }
    if (firstDsArrive && firstCountry) {
      const d = diffDays(firstDsArrive, firstCountry)
      if (Number.isFinite(d) && d >= 0) transitDays.push(d)
    }
    if (signDate && firstCountry) {
      const d = diffDays(signDate, firstCountry)
      if (Number.isFinite(d) && d >= 0) signDays.push(d)
    }
  }

  const volume = records.length
  const signRate = safeRate(signedCount, volume)
  const within24hRate = safeRate(within24hCount, dispatchedCount)
  const medianTransitDays = median(transitDays)
  const medianSignDays = median(signDays)

  const { station } = pickDominantStation(records)
  let stationRate: number | null = null
  if (station === 'melbourne' || station === 'sydney') {
    const targetKey = station === 'melbourne' ? MELBOURNE : SYDNEY
    const check = station === 'melbourne' ? isWithin2DWithWeekend : isWithin3DWithWeekend
    let matched = 0
    let subset = 0
    for (const rec of records) {
      if (normalizeStation(rec) !== targetKey) continue
      subset += 1
      const signDate = parseDate(readField(rec, 'signDate'))
      const firstCountry = parseDate(readField(rec, 'firstCountryDate'))
      if (check(signDate, firstCountry)) matched += 1
    }
    stationRate = safeRate(matched, subset)
  }

  const vendorCounts = new Map<string, number>()
  for (const rec of records) {
    const v = readVendor(rec)
    vendorCounts.set(v, (vendorCounts.get(v) ?? 0) + 1)
  }
  const topVendor =
    Array.from(vendorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const violations: string[] = []
  let status: RouteCodeStatus
  if (volume < thresholds.minVolume) {
    status = 'insufficient'
  } else {
    if (signRate !== null && signRate < thresholds.minSignRate) {
      violations.push(`签收率 ${(signRate * 100).toFixed(1)}% < ${Math.round(thresholds.minSignRate * 100)}%`)
    }
    if (within24hRate !== null && within24hRate < thresholds.minWithin24hRate) {
      violations.push(
        `24h 率 ${(within24hRate * 100).toFixed(1)}% < ${Math.round(thresholds.minWithin24hRate * 100)}%`,
      )
    }
    if (medianTransitDays !== null && medianTransitDays > thresholds.maxMedianTransitDays) {
      violations.push(`中位转运 ${medianTransitDays.toFixed(1)}D > ${thresholds.maxMedianTransitDays}D`)
    }
    if (violations.length === 0) status = 'ok'
    else if (violations.length === 1) status = 'warning'
    else status = 'bad'
  }

  return {
    routeCode,
    volume,
    signedCount,
    signRate,
    dispatchedCount,
    within24hCount,
    within24hRate,
    medianTransitDays,
    medianSignDays,
    dominantStation: station,
    stationRate,
    topVendor,
    violations,
    status,
  }
}

export function computeRouteCodePerformance(
  records: WaybillRecord[],
  thresholds: RouteCodeThresholds = DEFAULT_ROUTE_CODE_THRESHOLDS,
): RouteCodeRow[] {
  const groups = new Map<string, WaybillRecord[]>()
  for (const rec of records) {
    const key = readRouteCode(rec)
    const bucket = groups.get(key)
    if (bucket) bucket.push(rec)
    else groups.set(key, [rec])
  }

  const rows: RouteCodeRow[] = []
  for (const [routeCode, group] of groups) {
    rows.push(computeRouteCodeRow(routeCode, group, thresholds))
  }

  rows.sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rankDiff !== 0) return rankDiff
    const aRate = a.signRate ?? 1
    const bRate = b.signRate ?? 1
    if (aRate !== bRate) return aRate - bRate
    return b.volume - a.volume
  })

  return rows
}

export type CourierBreakdownRow = {
  key: string
  vendor: string
  courier: string
  courierCode: string
  waybillNos: string[]
  volume: number
  signedCount: number
  signRate: number | null
  medianTransitDays: number | null
}

export function computeCourierBreakdown(
  records: WaybillRecord[],
  routeCode: string,
): CourierBreakdownRow[] {
  const groups = new Map<string, { vendor: string; courier: string; courierCode: string; records: WaybillRecord[] }>()
  for (const rec of records) {
    if (readRouteCode(rec) !== routeCode) continue
    const vendor = readVendor(rec)
    const courier = readWaybillDriverName(rec)
    const courierCode = readWaybillDriverCode(rec)
    const key = `${vendor} ${courier} ${courierCode}`
    const bucket = groups.get(key)
    if (bucket) bucket.records.push(rec)
    else groups.set(key, { vendor, courier, courierCode, records: [rec] })
  }

  const rows: CourierBreakdownRow[] = []
  for (const [key, { vendor, courier, courierCode, records: group }] of groups) {
    let signedCount = 0
    const transitDays: number[] = []
    for (const rec of group) {
      if (isSigned(rec)) signedCount += 1
      const firstDsArrive = parseDate(readField(rec, 'firstDsArriveDate'))
      const firstCountry = parseDate(readField(rec, 'firstCountryDate'))
      if (firstDsArrive && firstCountry) {
        const d = diffDays(firstDsArrive, firstCountry)
        if (Number.isFinite(d) && d >= 0) transitDays.push(d)
      }
    }
    const volume = group.length
    const waybillNos = group.map((rec) => readWaybillNo(rec)).filter(Boolean)
    rows.push({
      key,
      vendor,
      courier,
      courierCode,
      waybillNos,
      volume,
      signedCount,
      signRate: safeRate(signedCount, volume),
      medianTransitDays: median(transitDays),
    })
  }

  rows.sort((a, b) => {
    if (a.vendor !== b.vendor) return a.vendor.localeCompare(b.vendor)
    if (b.volume !== a.volume) return b.volume - a.volume
    return a.courier.localeCompare(b.courier)
  })

  return rows
}
