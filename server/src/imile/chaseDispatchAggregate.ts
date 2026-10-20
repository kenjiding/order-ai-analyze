import {
  STAGNATION_BUCKETS,
  stagnationBucketLabel,
  type StagnationBucket,
  type StagnantWaybillRow,
} from './stagnantWaybills'

export type BucketResult = {
  bucket: StagnationBucket
  rows: StagnantWaybillRow[]
}

export type VendorStagnationWaybill = {
  waybillNo: string
  routeCode: string
  /** 「本地件优先客户」包裹，供落地页橙色标出；非优先件省略该字段 */
  isPriority?: boolean
}

export type VendorStagnationBucketDriverStat = {
  driverName: string
  driverCode: string
  count: number
  /** 该司机在本区间的「本地件优先客户」件数（已去重） */
  priorityCount: number
  /** 该司机在本区间的运单（已去重，按出现顺序，带路由码） */
  waybills: VendorStagnationWaybill[]
}

export type VendorStagnationBucketStat = {
  bucket: StagnationBucket
  label: string
  count: number
  drivers: VendorStagnationBucketDriverStat[]
}

export type VendorStagnationSummary = {
  totalStagnant: number
  /** 去重后的「本地件优先客户」滞留件数；滞留单全部未签收，无需再拆 unsigned */
  priorityTotal: number
  buckets: VendorStagnationBucketStat[]
}

function waybillKey(row: StagnantWaybillRow, index: number): string {
  const no = (row.waybillNo ?? '').trim()
  // 无单号时用位置兜底，避免把不同单误判为同一单（宁可多算，不可漏算）
  return no || `__row_${index}`
}

function isPriorityClient(clientCode: string | undefined, codes?: Set<string>): boolean {
  if (!codes || codes.size === 0 || !clientCode) return false
  return codes.has(clientCode.trim().toUpperCase())
}

export type ChaseDispatchPriorityLookup = {
  clientCodeByWaybillNo: Map<string, string>
  priorityClientCodes: Set<string>
}

/**
 * 按供应商代码（driverVendorCode 匹配）聚合多个滞留区间的结果。
 * 跨区间以 waybillNo 去重（相邻区间边界日期存在重叠），保证总数/司机数不重复计。
 * vendorCode 传空 = 调用方给的是「只按路由码匹配」的配置、行已按范围过滤过，这里不再按承运商收窄。
 */
export function aggregateVendorStagnation(
  bucketResults: BucketResult[],
  vendorCode: string,
  routeCodeByWaybillNo: Map<string, string> = new Map(),
  priority?: ChaseDispatchPriorityLookup,
): VendorStagnationSummary {
  const target = vendorCode.trim()
  const totalSeen = new Set<string>()
  const totalPrioritySeen = new Set<string>()

  const buckets: VendorStagnationBucketStat[] = []

  for (const { bucket, rows } of bucketResults) {
    const bucketSeen = new Set<string>()
    const driverSeen = new Map<string, Set<string>>()
    const driverMeta = new Map<string, { driverName: string; driverCode: string }>()
    const driverWaybills = new Map<string, VendorStagnationWaybill[]>()

    rows.forEach((row, index) => {
      if (target && (row.driverVendorCode ?? '').trim() !== target) return
      const key = waybillKey(row, index)
      const waybillNo = (row.waybillNo ?? '').trim()
      bucketSeen.add(key)
      totalSeen.add(key)

      const driverCode = (row.driverCode ?? '').trim() || '未知司机代码'
      const driverName = (row.driverName ?? '').trim() || '未知司机'
      if (!driverSeen.has(driverCode)) {
        driverSeen.set(driverCode, new Set())
        driverMeta.set(driverCode, { driverName, driverCode })
        driverWaybills.set(driverCode, [])
      }
      const seen = driverSeen.get(driverCode)!
      if (seen.has(key)) return
      seen.add(key)
      if (waybillNo) {
        const routeCode = routeCodeByWaybillNo.get(waybillNo) || '未知路由'
        const isPriority = isPriorityClient(priority?.clientCodeByWaybillNo.get(waybillNo), priority?.priorityClientCodes)
        if (isPriority) totalPrioritySeen.add(key)
        driverWaybills.get(driverCode)!.push({
          waybillNo,
          routeCode,
          ...(isPriority ? { isPriority: true } : {}),
        })
      }
    })

    const drivers: VendorStagnationBucketDriverStat[] = [...driverSeen.entries()]
      .map(([driverCode, keys]) => {
        const waybills = driverWaybills.get(driverCode) ?? []
        return {
          driverName: driverMeta.get(driverCode)!.driverName,
          driverCode,
          count: keys.size,
          priorityCount: waybills.filter((w) => w.isPriority).length,
          waybills,
        }
      })
      .sort((a, b) => b.count - a.count)

    buckets.push({ bucket, label: stagnationBucketLabel(bucket), count: bucketSeen.size, drivers })
  }

  // 入参 bucketResults 顺序取决于前端勾选顺序（非固定），这里按区间固定顺序重排，保证展示从 0-1 到 7+
  buckets.sort((a, b) => STAGNATION_BUCKETS.indexOf(a.bucket) - STAGNATION_BUCKETS.indexOf(b.bucket))

  return { totalStagnant: totalSeen.size, priorityTotal: totalPrioritySeen.size, buckets }
}
