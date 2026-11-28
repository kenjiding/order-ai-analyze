/**
 * 工单推送：按 waybillNo 批量查询运单供应商归属。
 * 工单本身的 currentHandleCode/responsibleDeptCode 是内部处理部门/责任人代码，
 * 未处理工单常常还没分配处理人，字段可能为空；courierVendorCode 才是稳定的承运供应商归属，
 * 用来决定该工单该催促哪个供应商处理。
 *
 * 原直连 ds.imile.com/saastms/v1/biz/waybillInfo/searchWaybill 接口与供应商日报等其他业务
 * 共用同一全局 token 时容易被限流（「系统繁忙」），改走「中心运单查询」异步导出任务
 * （见 centerWaybillQuery.ts），与到件扫描导出（inbound.ts）同一套风控规避方案。
 */

import { fetchCenterWaybillQueryRows } from './centerWaybillQuery'

export type WorkOrderPushWaybillError = { ok: false; status: number; message: string }
export type WorkOrderPushWaybillSuccess = { ok: true; data: Map<string, string> }

/**
 * 按 waybillNo 批量查「中心运单查询」，只提取供应商代码（courierVendorCode）。
 * 返回 waybillNo -> courierVendorCode 映射；查不到的单号不出现在结果里。
 */
export async function fetchWorkOrderWaybillVendors(
  token: string,
  waybillNos: string[],
): Promise<WorkOrderPushWaybillSuccess | WorkOrderPushWaybillError> {
  const data = new Map<string, string>()
  if (waybillNos.length === 0) return { ok: true, data }

  const rowsRes = await fetchCenterWaybillQueryRows(token, waybillNos)
  if (!rowsRes.ok) return { ok: false, status: rowsRes.status, message: rowsRes.message }

  for (const row of rowsRes.rows) {
    const waybillNo = row.waybillNo?.trim() ?? ''
    const courierVendorCode = row.courierVendorCode?.trim() ?? ''
    if (waybillNo && courierVendorCode) data.set(waybillNo, courierVendorCode)
  }

  return { ok: true, data }
}
