import {
  stagnationBucketLabel,
  type StagnationBucket,
  type StagnantWaybillRow,
} from './stagnantWaybills'

export type BucketResult = {
  bucket: StagnationBucket
  rows: StagnantWaybillRow[]
}

export type VendorStagnationBucketStat = {
  bucket: StagnationBucket
  label: string
  count: number
}

export type VendorStagnationDriverStat = {
  driverName: string
  driverCode: string
  count: number
}

export type VendorStagnationSummary = {
  totalStagnant: number
  buckets: VendorStagnationBucketStat[]
  drivers: VendorStagnationDriverStat[]
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
  const driverSeen = new Map<string, Set<string>>()
  const driverMeta = new Map<string, { driverName: string; driverCode: string }>()

  const buckets: VendorStagnationBucketStat[] = []

  for (const { bucket, rows } of bucketResults) {
    const bucketSeen = new Set<string>()
    rows.forEach((row, index) => {
      if ((row.driverVendorCode ?? '').trim() !== target) return
      const key = waybillKey(row, index)
      bucketSeen.add(key)
      totalSeen.add(key)

      const driverCode = (row.driverCode ?? '').trim() || '未知司机代码'
      const driverName = (row.driverName ?? '').trim() || '未知司机'
      const driverKey = driverCode
      if (!driverSeen.has(driverKey)) {
        driverSeen.set(driverKey, new Set())
        driverMeta.set(driverKey, { driverName, driverCode })
      }
      driverSeen.get(driverKey)!.add(key)
    })
    buckets.push({ bucket, label: stagnationBucketLabel(bucket), count: bucketSeen.size })
  }

  const drivers: VendorStagnationDriverStat[] = [...driverSeen.entries()]
    .map(([driverKey, keys]) => ({
      driverName: driverMeta.get(driverKey)!.driverName,
      driverCode: driverMeta.get(driverKey)!.driverCode,
      count: keys.size,
    }))
    .sort((a, b) => b.count - a.count)

  return { totalStagnant: totalSeen.size, buckets, drivers }
}
