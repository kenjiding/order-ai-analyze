/**
 * searchWaybill 的数据库查询替代层。
 * 待接入 iMile 库的只读副本/ODS 表后，在这里按 waybillNo 查询即可；调用方
 * （到件索引明细拉取、催派路由码查询）字段结构保持不变，不需要跟着改。
 */
import type { InboundWaybillRow } from './inboundWaybillIndex'

export async function queryWaybillDetailsByNos(waybillNos: string[]): Promise<InboundWaybillRow[]> {
  if (waybillNos.length === 0) return []
  // TODO: 替换为真实查询，例如 SELECT ... FROM waybill WHERE waybill_no = ANY($1)
  return []
}
