import {
  stagnationBucketLabel,
  type StagnationBucket,
  type StagnantWaybillRow,
} from './stagnantWaybills'

export type BucketResult = {
  bucket: StagnationBucket
  rows: StagnantWaybillRow[]
}

export type VendorStagnationBucketDriverStat = {
  driverName: string
  driverCode: string
  count: number
  /** 该司机在本区间的运单号（已去重，按出现顺序） */
  waybillNos: string[]
}

export type VendorStagnationBucketStat = {
  bucket: StagnationBucket
  label: string
  count: number
  drivers: VendorStagnationBucketDriverStat[]
}

export type VendorStagnationSummary = {
  totalStagnant: number
  buckets: VendorStagnationBucketStat[]
}

function waybillKey(row: StagnantWaybillRow, index: number): string {
  const no = (row.waybillNo ?? '').trim()
  // 无单号时用位置兜底，避免把不同单误判为同一单（宁可多算，不可漏算）
  return no || `__row_${index}`
}

/**
 * 按供应商代码（driverVendorCode 匹配）聚合多个滞留区间的结果。
 * 跨区间以 waybillNo 去重（相邻区间边界日期存在重叠），保证总数/司机数不重复计。
 */
export function aggregateVendorStagnation(
  bucketResults: BucketResult[],
  vendorCode: string,
): VendorStagnationSummary {
  const target = vendorCode.trim()
  const totalSeen = new Set<string>()

  const buckets: VendorStagnationBucketStat[] = []

  for (const { bucket, rows } of bucketResults) {
    const bucketSeen = new Set<string>()
    const driverSeen = new Map<string, Set<string>>()
    const driverMeta = new Map<string, { driverName: string; driverCode: string }>()
    const driverWaybillNos = new Map<string, string[]>()

    rows.forEach((row, index) => {
      if ((row.driverVendorCode ?? '').trim() !== target) return
      const key = waybillKey(row, index)
      const waybillNo = (row.waybillNo ?? '').trim()
      bucketSeen.add(key)
      totalSeen.add(key)

      const driverCode = (row.driverCode ?? '').trim() || '未知司机代码'
      const driverName = (row.driverName ?? '').trim() || '未知司机'
      if (!driverSeen.has(driverCode)) {
        driverSeen.set(driverCode, new Set())
        driverMeta.set(driverCode, { driverName, driverCode })
        driverWaybillNos.set(driverCode, [])
      }
      const seen = driverSeen.get(driverCode)!
      if (seen.has(key)) return
      seen.add(key)
      if (waybillNo) driverWaybillNos.get(driverCode)!.push(waybillNo)
    })

    const drivers: VendorStagnationBucketDriverStat[] = [...driverSeen.entries()]
      .map(([driverCode, keys]) => ({
        driverName: driverMeta.get(driverCode)!.driverName,
        driverCode,
        count: keys.size,
        waybillNos: driverWaybillNos.get(driverCode) ?? [],
      }))
      .sort((a, b) => b.count - a.count)

    buckets.push({ bucket, label: stagnationBucketLabel(bucket), count: bucketSeen.size, drivers })
  }

  return { totalStagnant: totalSeen.size, buckets }
}
