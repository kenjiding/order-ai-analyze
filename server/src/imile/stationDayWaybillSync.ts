/**
 * 站点日运单增量同步：写入 driver_map_waybill_points，供 24H 派签告警与司机地图共用。
 * 已达标 / 已超窗口的单号跳过 searchWaybill，只拉未终态子集。
 */
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { AusTz } from './ausTimezone'
import {
  fetchWaybillDetailsIncremental,
  type InboundWaybillRow,
} from './inboundWaybillIndex'
import type { Dispatch24hWaybillRow } from '../vendorAnalysis/dispatch24hAggregate'

function readText(row: InboundWaybillRow | Dispatch24hWaybillRow, key: string): string {
  const v = (row as Record<string, unknown>)[key]
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 组合 Google Geocoding 用地址。澳洲常见格式：
 * `详细地址, 城市, 省 邮编, Australia`
 * 例：`12 King William St, Adelaide, SA 5000, Australia`
 *
 * iMile 的 consigneeAddress 有时已含 suburb/州/邮编/Australia，此时不再重复拼接其余字段。
 */
function buildAddressText(row: InboundWaybillRow): string {
  const address =
    readText(row, 'consigneeAddress') ||
    readText(row, 'consigneeDetailedAddress') ||
    readText(row, 'consigneeAddr') ||
    readText(row, 'address')
  const city = readText(row, 'consigneeCity') || readText(row, 'city')
  const province =
    readText(row, 'consigneeProvince') || readText(row, 'province') || readText(row, 'state')
  const zipCode =
    readText(row, 'consigneeZipCode') ||
    readText(row, 'consigneePostCode') ||
    readText(row, 'zipCode')

  if (!address && !city && !province && !zipCode) return ''

  const addressLower = address.toLowerCase()
  const alreadyRich =
    /\baustralia\b/i.test(address) ||
    (Boolean(zipCode) && address.includes(zipCode)) ||
    (Boolean(city) && addressLower.includes(city.toLowerCase()))

  if (alreadyRich) {
    return /\baustralia\b/i.test(address) ? address : `${address}, Australia`
  }

  // 省与邮编紧挨（SA 5000），比用逗号分隔更易被 Geocoding 识别
  const region = [province, zipCode].filter(Boolean).join(' ')
  const parts = [address, city, region, 'Australia'].filter(Boolean)
  if (parts.length <= 1) return address
  return parts.join(', ')
}

function resolvePointStatus(signDate: string, lastProblemDate: string): 'completed' | 'problem' | 'pending' {
  if (signDate) return 'completed'
  if (lastProblemDate) return 'problem'
  return 'pending'
}

function toCacheRow(row: typeof schema.driverMapWaybillPoints.$inferSelect): Dispatch24hWaybillRow {
  return {
    waybillNo: row.waybillNo,
    courier: row.courierName || undefined,
    courierCode: row.courierCode || undefined,
    courierVendorCode: row.vendorCode || undefined,
    consigneeRouteCode: row.consigneeRouteCode || undefined,
    lastScanSiteCode: row.lastScanSiteCode || row.stationCode || undefined,
    deliveryTime: row.deliveryTime ?? undefined,
    signDate: row.signDate ?? undefined,
    lastProblemDate: row.lastProblemDate ?? undefined,
  }
}

export async function loadStationDayWaybillCache(
  stationCode: string,
  dataDate: string,
): Promise<Map<string, Dispatch24hWaybillRow>> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
      ),
    )
  const map = new Map<string, Dispatch24hWaybillRow>()
  for (const row of rows) map.set(row.waybillNo, toCacheRow(row))
  return map
}

export type StationDayWaybillSyncResult = {
  ok: true
  stationCode: string
  dataDate: string
  indexCount: number
  fetchedCount: number
  skippedCount: number
  upsertedCount: number
}

/**
 * 增量同步某站点某日运单到缓存表。仅更新本次新拉到的明细；终态单保留原行。
 * 不负责地理编码（司机地图刷新在此之后单独 geocode）。
 */
export async function syncStationDayWaybillsIncremental(input: {
  token: string
  stationCode: string
  dataDate: string
  tz: AusTz
  label: string
  nowMs?: number
}): Promise<StationDayWaybillSyncResult | { ok: false; message: string }> {
  const { token, stationCode, dataDate, tz, label, nowMs } = input
  const cachedByWaybillNo = await loadStationDayWaybillCache(stationCode, dataDate)

  const fetched = await fetchWaybillDetailsIncremental({
    token,
    stationCode,
    dateStr: dataDate,
    label,
    tz,
    cachedByWaybillNo,
    nowMs,
  })
  if (!fetched.ok) return { ok: false, message: fetched.message }

  const db = getDb()
  const now = new Date()
  let upsertedCount = 0

  for (const row of fetched.fetchedRecords) {
    const waybillNo = readText(row, 'waybillNo')
    if (!waybillNo) continue
    const signDate = readText(row, 'signDate') || null
    const lastProblemDate = readText(row, 'lastProblemDate') || null
    const deliveryTime = readText(row, 'deliveryTime') || null
    const vendorCode = readText(row, 'courierVendorCode')
    const courierCode = readText(row, 'courierCode')
    const courierName = readText(row, 'courier')
    const consigneeRouteCode = readText(row, 'consigneeRouteCode')
    const lastScanSiteCode = readText(row, 'lastScanSiteCode') || stationCode
    const addressText = buildAddressText(row)
    const problemReason =
      readText(row, 'problemReason') ||
      readText(row, 'problemReasonDesc') ||
      readText(row, 'lastProblemReason') ||
      ''
    const status = resolvePointStatus(signDate ?? '', lastProblemDate ?? '')

    const existing = await db
      .select({
        addressText: schema.driverMapWaybillPoints.addressText,
        latitude: schema.driverMapWaybillPoints.latitude,
        longitude: schema.driverMapWaybillPoints.longitude,
        geocodedAt: schema.driverMapWaybillPoints.geocodedAt,
      })
      .from(schema.driverMapWaybillPoints)
      .where(
        and(
          eq(schema.driverMapWaybillPoints.waybillNo, waybillNo),
          eq(schema.driverMapWaybillPoints.dataDate, dataDate),
        ),
      )
      .limit(1)

    const prev = existing[0]
    const addressChanged = !prev || prev.addressText !== addressText

    await db
      .insert(schema.driverMapWaybillPoints)
      .values({
        waybillNo,
        stationCode,
        vendorCode,
        courierCode,
        courierName,
        dataDate,
        deliveryTime,
        signDate,
        lastProblemDate,
        problemReason,
        consigneeRouteCode,
        lastScanSiteCode,
        status,
        addressText,
        latitude: null,
        longitude: null,
        geocodedAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.driverMapWaybillPoints.waybillNo, schema.driverMapWaybillPoints.dataDate],
        set: {
          stationCode,
          vendorCode,
          courierCode,
          courierName,
          deliveryTime,
          signDate,
          lastProblemDate,
          problemReason,
          consigneeRouteCode,
          lastScanSiteCode,
          status,
          addressText,
          ...(addressChanged
            ? { latitude: null, longitude: null, geocodedAt: null }
            : {
                latitude: prev?.latitude ?? null,
                longitude: prev?.longitude ?? null,
                geocodedAt: prev?.geocodedAt ?? null,
              }),
          updatedAt: now,
        },
      })
    upsertedCount += 1
  }

  console.log(
    `[waybill-sync] ${label} station=${stationCode} date=${dataDate} index=${fetched.waybillNos.length} fetched=${fetched.fetchedCount} skipped=${fetched.skippedCount} upserted=${upsertedCount}`,
  )

  return {
    ok: true,
    stationCode,
    dataDate,
    indexCount: fetched.waybillNos.length,
    fetchedCount: fetched.fetchedCount,
    skippedCount: fetched.skippedCount,
    upsertedCount,
  }
}

/** 从缓存表读出可供 24H 聚合的运单行（含尚无签收的 pending） */
export async function listStationDayWaybillRows(
  stationCode: string,
  dataDate: string,
): Promise<Dispatch24hWaybillRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.driverMapWaybillPoints)
    .where(
      and(
        eq(schema.driverMapWaybillPoints.stationCode, stationCode),
        eq(schema.driverMapWaybillPoints.dataDate, dataDate),
      ),
    )
  return rows.map(toCacheRow)
}
