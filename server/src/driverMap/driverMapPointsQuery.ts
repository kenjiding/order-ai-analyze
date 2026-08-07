/**
 * 司机地图：从站点日运单缓存读点位（签收/未签收/问题件）。
 * 数据日与「11点前出仓」一致（before11Date）；分析任务首次同步，手动「刷新」对未终态增量再拉。
 * 坐标来源：iMile 分拣坐标查询（sorting/pageList），按运单号直接取，见 ../imile/sortingGeocoding。
 */
import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { AUS_TZ, iMileStrToMs, localDateInTz, type AusTz } from '../imile/ausTimezone'
import { syncStationDayWaybillsIncremental } from '../imile/stationDayWaybillSync'
import { fetchSearchWaybillByNos } from '../imile/inboundWaybillIndex'
import { fetchSortingGeocodingByWaybillNos } from '../imile/sortingGeocoding'
import { envFirst } from '../imile/shared'
import { getGlobalImileToken } from '../feishu/globalImileToken'

export type DriverMapPointDto = {
  waybillNo: string
  status: 'completed' | 'problem' | 'pending'
  lat: number
  lng: number
  time: string
  address: string
  /** 问题件原因（仅 status=problem 时有意义） */
  problemReason?: string
}

export type DriverMapDriverDto = {
  courierCode: string
  courierName: string
  points: DriverMapPointDto[]
  currentPosition: { lat: number; lng: number } | null
}

export type DriverMapPointsResult = {
  dataDate: string
  stationCode: string
  drivers: DriverMapDriverDto[]
  totalCount: number
  geocodedCount: number
  pendingCount: number
  completedCount: number
  problemCount: number
}

export type DriverMapPointsQueryOutcome =
  | { ok: true; data: DriverMapPointsResult }
  | { ok: false; message: string }

/**
 * 复用用户已在「24小时派签告警」页面保存过的 iMile token，不要求为司机地图单独配置一遍。
 * 优先读该用户「系统设置」里的全局最新 token（schedule 表的 imileToken 只是保存那一刻的快照，
 * 用户之后在系统设置改 token 不会级联同步过去，会导致 oc.imile.com 报 Invalid access token）。
 */
export async function readDriverMapImileToken(): Promise<string> {
  const db = getDb()
  const rows = await db
    .select({ imileToken: schema.dispatchAlarmSchedules.imileToken, userId: schema.dispatchAlarmSchedules.userId })
    .from(schema.dispatchAlarmSchedules)
    .where(and(isNotNull(schema.dispatchAlarmSchedules.imileToken), ne(schema.dispatchAlarmSchedules.imileToken, '')))
    .limit(1)
  const row = rows[0]
  if (row?.userId) {
    const fromGlobalSettings = await getGlobalImileToken(row.userId)
    if (fromGlobalSettings) return fromGlobalSettings
  }
  const fromSchedule = row?.imileToken?.trim()
  if (fromSchedule) return fromSchedule
  return envFirst('IMILE_DISPATCH_ALARM_TOKEN') ?? ''
}

/** 把按运单号查到的坐标批量写回点位表；insert 分支不会真正触发，只是借 upsert 语法做批量部分字段更新 */
async function applyGeocodedCoordsToPoints(
  dataDate: string,
  entries: Array<[string, { latitude: number; longitude: number }]>,
): Promise<number> {
  if (entries.length === 0) return 0
  const db = getDb()
  const p = schema.driverMapWaybillPoints
  const now = new Date()
  await db
    .insert(p)
    .values(
      entries.map(([waybillNo, coord]) => ({
        waybillNo,
        dataDate,
        stationCode: '',
        latitude: coord.latitude,
        longitude: coord.longitude,
        geocodedAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [p.waybillNo, p.dataDate],
      set: {
        latitude: sql`excluded.latitude`,
        longitude: sql`excluded.longitude`,
        geocodedAt: sql`excluded.geocoded_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
  return entries.length
}

/**
 * 为尚无坐标的运单查坐标：按运单号批量查 iMile sorting/pageList，直接拿 lat/lng，
 * 不再需要地址文本、不再需要跨运单地址缓存。
 * 传 vendorCode 时只处理该供应商（门户用）。
 */
export async function geocodePendingMapPoints(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
  /** 未传则回退 24H 派签告警已保存的 token（同 ensureProblemReasons） */
  token?: string
  /** 每处理一批坐标回调一次，供任务进度上报（顺带充当心跳） */
  onProgress?: (done: number, total: number) => void | Promise<void>
}): Promise<number> {
  const { stationCode, dataDate, vendorCode, onProgress } = input
  const token = input.token?.trim() || (await readDriverMapImileToken())
  if (!token) {
    console.warn('[driver-map/geocode] 未配置 iMile token，跳过坐标查询')
    return 0
  }

  const db = getDb()
  const rows = await db
    .select({ waybillNo: schema.driverMapWaybillPoints.waybillNo })
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
        inArray(schema.driverMapWaybillPoints.status, ['completed', 'problem', 'pending']),
        or(isNull(schema.driverMapWaybillPoints.latitude), isNull(schema.driverMapWaybillPoints.longitude)),
        vendorCode ? eq(schema.driverMapWaybillPoints.vendorCode, vendorCode) : undefined,
      ),
    )

  if (rows.length === 0) {
    console.info(`[driver-map/geocode] station=${stationCode} date=${dataDate} vendor=${vendorCode ?? '*'} pending=0`)
    return 0
  }

  const waybillNos = rows.map((r) => r.waybillNo)
  const geocoded = await fetchSortingGeocodingByWaybillNos({
    token,
    waybillNos,
    dataDate,
    label: '司机地图坐标查询',
    tz: AUS_TZ.Adelaide,
  })

  if (!geocoded.ok) {
    console.warn(`[driver-map/geocode] 查询失败: ${geocoded.message}`)
    return 0
  }

  let updated = 0
  const entries = [...geocoded.coordsByWaybillNo.entries()]
  for (let i = 0; i < entries.length; i += 500) {
    const part = entries.slice(i, i + 500)
    updated += await applyGeocodedCoordsToPoints(dataDate, part)
    if (onProgress) await onProgress(Math.min(i + part.length, entries.length), entries.length)
  }

  console.info(
    `[driver-map/geocode] station=${stationCode} date=${dataDate} vendor=${vendorCode ?? '*'} pending=${waybillNos.length} resolved=${entries.length} updatedRows=${updated}`,
  )
  return updated
}

type DriverMapPointRow = Pick<
  typeof schema.driverMapWaybillPoints.$inferSelect,
  | 'waybillNo'
  | 'vendorCode'
  | 'courierCode'
  | 'courierName'
  | 'deliveryTime'
  | 'signDate'
  | 'lastProblemDate'
  | 'problemReason'
  | 'status'
  | 'addressText'
  | 'latitude'
  | 'longitude'
>

function buildDriversFromRows(rows: DriverMapPointRow[]): {
  drivers: DriverMapDriverDto[]
  totalCount: number
  geocodedCount: number
  pendingCount: number
  completedCount: number
  problemCount: number
} {
  const completedCount = rows.filter((r) => r.status === 'completed').length
  const problemCount = rows.filter((r) => r.status === 'problem').length
  const pendingCount = rows.filter((r) => r.status === 'pending').length
  const plottable = rows.filter(
    (r) => r.status === 'completed' || r.status === 'problem' || r.status === 'pending',
  )

  const byDriver = new Map<string, { courierCode: string; courierName: string; points: DriverMapPointDto[] }>()
  let geocodedCount = 0

  for (const row of plottable) {
    if (row.latitude == null || row.longitude == null) continue
    const rawTime =
      row.status === 'completed'
        ? row.signDate
        : row.status === 'problem'
          ? row.lastProblemDate
          : row.deliveryTime
    if (!rawTime && row.status !== 'pending') continue
    // pending 无派送时间时用哨兵，保证 time 恒为 string 且排序稳定
    const time = rawTime || '1970-01-01 00:00:00'
    geocodedCount += 1

    const key = row.courierCode || `unknown:${row.vendorCode}`
    if (!byDriver.has(key)) {
      byDriver.set(key, {
        courierCode: row.courierCode,
        courierName: row.courierName || row.courierCode,
        points: [],
      })
    }
    byDriver.get(key)!.points.push({
      waybillNo: row.waybillNo,
      status: row.status as 'completed' | 'problem' | 'pending',
      lat: row.latitude,
      lng: row.longitude,
      time,
      address: row.addressText,
      problemReason: row.status === 'problem' ? row.problemReason || undefined : undefined,
    })
  }

  const drivers = [...byDriver.values()].map((d) => {
    const points = [...d.points].sort((a, b) => iMileStrToMs(a.time) - iMileStrToMs(b.time))
    // 当前位置取最近一单「已签收/问题件」，未签收不参与定位近似
    const terminal = points.filter((p) => p.status !== 'pending')
    const trail = terminal.length > 0 ? terminal : points
    return {
      courierCode: d.courierCode,
      courierName: d.courierName,
      points,
      currentPosition: trail.length > 0 ? { lat: trail[trail.length - 1]!.lat, lng: trail[trail.length - 1]!.lng } : null,
    }
  })

  return {
    drivers,
    totalCount: completedCount + problemCount,
    geocodedCount,
    pendingCount,
    completedCount,
    problemCount,
  }
}

/**
 * 该站点该日是否已同步过运单缓存（不区分供应商，同步本身是整站的）。
 * 供调用方判断要不要先做一次全量同步，还是直接走增量补坐标。
 */
export async function hasDriverMapWaybillRows(input: {
  stationCode: string
  dataDate: string
}): Promise<boolean> {
  const db = getDb()
  const p = schema.driverMapWaybillPoints
  const [row] = await db
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.stationCode, input.stationCode), eq(p.dataDate, input.dataDate)))
    .limit(1)
  return Boolean(row)
}

/** 从缓存表组装地图点位（不触发 iMile 拉取） */
export async function queryDriverMapPoints(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
}): Promise<DriverMapPointsQueryOutcome> {
  const { stationCode, dataDate, vendorCode } = input
  const db = getDb()
  const p = schema.driverMapWaybillPoints
  const rows = await db
    .select({
      waybillNo: p.waybillNo,
      vendorCode: p.vendorCode,
      courierCode: p.courierCode,
      courierName: p.courierName,
      deliveryTime: p.deliveryTime,
      signDate: p.signDate,
      lastProblemDate: p.lastProblemDate,
      problemReason: p.problemReason,
      status: p.status,
      addressText: p.addressText,
      latitude: p.latitude,
      longitude: p.longitude,
    })
    .from(p)
    .where(
      and(
        eq(p.stationCode, stationCode),
        eq(p.dataDate, dataDate),
        vendorCode ? eq(p.vendorCode, vendorCode) : undefined,
      ),
    )

  const built = buildDriversFromRows(rows)
  return {
    ok: true,
    data: {
      dataDate,
      stationCode,
      drivers: built.drivers,
      totalCount: built.totalCount,
      geocodedCount: built.geocodedCount,
      pendingCount: built.pendingCount,
      completedCount: built.completedCount,
      problemCount: built.problemCount,
    },
  }
}

export type DriverMapRefreshResult = {
  dataDate: string
  stationCode: string
  indexCount: number
  fetchedCount: number
  skippedCount: number
  geocodedUpdated: number
  points: DriverMapPointsResult
}

/**
 * 为缺 reason 的问题件补 problemReason（门户打开时按供应商范围拉取，避免历史缓存永远空白）。
 */
export async function ensureProblemReasons(input: {
  stationCode: string
  dataDate: string
  vendorCode?: string
  /** 未传则回退 24H 派签告警已保存的 token */
  token?: string
}): Promise<number> {
  const { stationCode, dataDate, vendorCode } = input
  const db = getDb()
  const token = input.token?.trim() || (await readDriverMapImileToken())
  if (!token) return 0

  const rows = await db
    .select({
      waybillNo: schema.driverMapWaybillPoints.waybillNo,
      id: schema.driverMapWaybillPoints.id,
    })
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
        eq(schema.driverMapWaybillPoints.status, 'problem'),
        eq(schema.driverMapWaybillPoints.problemReason, ''),
        vendorCode ? eq(schema.driverMapWaybillPoints.vendorCode, vendorCode) : undefined,
      ),
    )

  if (rows.length === 0) return 0

  const fetched = await fetchSearchWaybillByNos({
    token,
    stationCode,
    dateStr: dataDate,
    waybillNos: rows.map((r) => r.waybillNo),
    label: '司机地图补问题件原因',
    tz: AUS_TZ.Adelaide,
  })
  if (!fetched.ok) {
    console.warn(`[driver-map/problem-reason] 拉取失败: ${fetched.message}`)
    return 0
  }

  const reasonByNo = new Map<string, string>()
  for (const row of fetched.records) {
    const no = typeof row.waybillNo === 'string' ? row.waybillNo.trim() : ''
    if (!no) continue
    const reason =
      (typeof row.problemReason === 'string' && row.problemReason.trim()) ||
      (typeof row.problemReasonDesc === 'string' && row.problemReasonDesc.trim()) ||
      (typeof row.lastProblemReason === 'string' && row.lastProblemReason.trim()) ||
      ''
    if (reason) reasonByNo.set(no, reason)
  }

  let updated = 0
  const now = new Date()
  for (const row of rows) {
    const reason = reasonByNo.get(row.waybillNo)
    if (!reason) continue
    await db
      .update(schema.driverMapWaybillPoints)
      .set({ problemReason: reason, updatedAt: now })
      .where(eq(schema.driverMapWaybillPoints.id, row.id))
    updated += 1
  }
  console.info(
    `[driver-map/problem-reason] station=${stationCode} date=${dataDate} vendor=${vendorCode ?? '*'} missing=${rows.length} updated=${updated}`,
  )
  return updated
}

/**
 * 将某站点某日运单增量写入司机地图缓存并补地理编码。
 * 由分析任务（出仓日 before11Date）触发。
 */
export async function populateDriverMapCache(input: {
  token: string
  stationCode: string
  dataDate: string
  tz: AusTz
  vendorCode?: string
  label?: string
  /** 只包住真正打 iMile 的步骤（运单同步/补问题原因）；geocode 与 DB 写入不占 iMile 并发闸 */
  imileGate?: <T>(fn: () => Promise<T>) => Promise<T>
  /** geocode 进度回调，供任务进度上报 */
  onGeocodeProgress?: (done: number, total: number) => void | Promise<void>
}): Promise<{ ok: true; data: DriverMapRefreshResult } | { ok: false; message: string }> {
  const { token, stationCode, dataDate, vendorCode, tz, onGeocodeProgress } = input
  const label = input.label ?? '司机地图同步'
  const imileGate = input.imileGate ?? (<T>(fn: () => Promise<T>) => fn())

  const synced = await imileGate(() =>
    syncStationDayWaybillsIncremental({
      token,
      stationCode,
      dataDate,
      tz,
      label,
    }),
  )
  if (!synced.ok) return synced

  await imileGate(() => ensureProblemReasons({ stationCode, dataDate, vendorCode, token }))
  const geocodedUpdated = await geocodePendingMapPoints({
    stationCode,
    dataDate,
    vendorCode,
    token,
    onProgress: onGeocodeProgress,
  })
  const points = await queryDriverMapPoints({ stationCode, dataDate, vendorCode })
  if (!points.ok) return points

  return {
    ok: true,
    data: {
      dataDate,
      stationCode,
      indexCount: synced.indexCount,
      fetchedCount: synced.fetchedCount,
      skippedCount: synced.skippedCount,
      geocodedUpdated,
      points: points.data,
    },
  }
}

/**
 * 司机地图缓存保留天数：这张表只是 iMile 的缓存（本地无数据时会自动整表重新拉取，不会丢数据），
 * 唯一还在用它的 24H 派签告警落地页，分享快照本身就是保留 1 天（见 dispatchAlarmShareSnapshot.ts），
 * 这里多留 1 天做缓冲，避免快照还没过期、底层点位数据先被清掉。
 */
export const DRIVER_MAP_RETENTION_DAYS = 2

/** 删除超过保留期的司机地图缓存行（按业务日期 dataDate，不是 updatedAt——重跑历史分析会刷新 updatedAt 但业务日期不变） */
export async function purgeOldDriverMapWaybillPoints(
  keepDays = DRIVER_MAP_RETENTION_DAYS,
): Promise<number> {
  const cutoff = localDateInTz(Date.now() - keepDays * 24 * 60 * 60 * 1000, AUS_TZ.Adelaide)
  const db = getDb()
  const deleted = await db
    .delete(schema.driverMapWaybillPoints)
    .where(lt(schema.driverMapWaybillPoints.dataDate, cutoff))
    .returning({ id: schema.driverMapWaybillPoints.id })
  return deleted.length
}
