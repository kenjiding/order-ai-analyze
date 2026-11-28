/**
 * 中心运单查询（抓包自 ds.imile.com saastms 运单查询页「导出」按钮）：按 waybillNo 批量取运单详情，
 * 走 ipep 异步导出任务（建任务 → 轮询 → 换链接 → 下载 xlsx），用于替代直连
 * saastms/v1/biz/waybillInfo/searchWaybill 被其他业务线共用同一 token 时限流/风控的场景。
 * 导出列很全（见 CENTER_WAYBILL_QUERY_COLUMN_MAP），调用方按需取字段即可，不必再加一个接口封装。
 */
import { fetchImileExportRows, type ImileExportJobError } from './ipepExportJob'
import { IMILE_DS_SAAS_TMS_PORTAL } from './portal'
import { normalizeImileToken, sleep } from './shared'

const BIZ_TYPE = 290100
const MODULE_ID = 10002
const JOB_NAME = '中心运单查询'
/** 与直连 searchWaybill 共用同一个 saastms 运单查询页（workOrderPushWaybills.ts 原来的门户头） */
const PAGE = { envPrefix: 'IMILE_CENTER_WAYBILL_EXPORT', defaults: IMILE_DS_SAAS_TMS_PORTAL }

/** iMile 硬限制：单次查询单号不超过 1000 条（与原 searchWaybill 分批逻辑一致） */
const WAYBILL_QUERY_BATCH_SIZE = 1000
const BATCH_DELAY_MS = 300

/** 抓包自导出按钮的列定义 XML，add_export 必须原样带上，否则报参数缺失；新增列改这里 + COLUMN_MAP 即可 */
const TITLES_XML = `<?xml version="1.0" encoding="UTF-8"?> <exl-title-list xmlns="http://schema.imile.com/exl-title-list" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schema.imile.com/exl-title-list http://schema.imile.com/exl-title-list/exl-title-list.xsd"> <exlTitles><exlTitle  name="运单号" title="waybillNo" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="路由码" title="consigneeRouteCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="商家编号" title="clientCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新问题件时间" title="lastProblemDate" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件时间" title="deliveryTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="签收时间" title="signDate" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="目的国首次到件时间" title="firstCountryDate" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="DS首次到件时间" title="firstDsArriveDate" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件司机" title="daName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件司机所属供应商" title="courierVendor" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新扫描网点" title="lastScanSite" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="揽收司机名称" title="pickUpUserName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="创建时间" title="createDate" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="揽收司机账号" title="pickUpUserCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="实收网点" title="actualReceiveStation" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="参考订单号" title="referenceNo" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件时间" title="receiveTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="预约派送日期" title="schedulePieDate" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="原运单号" title="referenceWaybillNo" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="揽件网点" title="receiveStation" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件门牌号" title="consigneeInternalNumber" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新扫描人" title="lastScanUserName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新扫描类型" title="lastScanStatus" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新扫描时间" title="lastScanTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新问题件类型" title="problemType" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="最新问题件原因" title="problemReason" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="自提状态" title="pudoStatusDesc" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="交邮时间" title="shipmentRdcTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退件状态" title="returnStatusStr" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退件新单号" title="newWaybillNo" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退件扫描时间" title="returnScanTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退货最新扫描时间" title="newWaybillLastScanTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退件最新扫描操作" title="newWaybillLastScanType" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退件原因" title="returnReason" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件网点" title="dispatchStation" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="送货方式" title="deliveryMethodDesc" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="自提点" title="pointName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件司机编号" title="daCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件司机所属供应商编码" title="courierVendorCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="拦截状态" title="interceptStatusStr" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="完结状态" title="closeStatusStr" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="完结时间" title="closeTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="配送状态" title="dispatchStatus" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="上架网点" title="ocName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="库位编号" title="locationCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="退货处理方式" title="returnProcessingMethod" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="默认处理方式" title="defaultHandleMethodDesc" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="订单类型" title="orderType" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件人姓名" title="consigneeContact" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件省" title="consigneeProvince" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件市" title="consigneeCity" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件区" title="consigneeArea" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="邮编" title="consigneeZipCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="预派件网点编码" title="preDeliveryStationCode" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="提货网点" title="pickupStationName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="派件供应商" title="deliveryCspVendorName" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="目的国入网时间" title="netWorkTime" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="件数" title="skuQty" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="商家上传体积(cm³)" title="businessTotalVolume" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="商家上传重量" title="businessTotalWeight" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="商家上传体积重量(kg)" title="businessVolumeWeight" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件总重量" title="pickupWeight" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件总体积" title="pickupVolume" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件体积重量(kg)" title="pickupVolumeWeight" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="大小" title="intlBagSize" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="寄件国家" title="consignorCountry" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="寄件联系人" title="consignorContact" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件电话" title="consigneePhone" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件人详细地址" title="consigneeAddress" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件邮箱" title="consigneeEmail" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="收件国家" title="consigneeCountry" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="寄件网点" title="shippingStation" colspan="1" rowspan="1" group="false" > </exlTitle><exlTitle  name="NDR状态" title="ndrStatus" colspan="1" rowspan="1" group="false" > </exlTitle></exlTitles> </exl-title-list>`

/** 表头文本 → 字段名，取自 TITLES_XML 的 name→title，供 downloadImileExportRows 用 */
export const CENTER_WAYBILL_QUERY_COLUMN_MAP: Record<string, string> = {
  运单号: 'waybillNo',
  路由码: 'consigneeRouteCode',
  商家编号: 'clientCode',
  最新问题件时间: 'lastProblemDate',
  派件时间: 'deliveryTime',
  签收时间: 'signDate',
  目的国首次到件时间: 'firstCountryDate',
  DS首次到件时间: 'firstDsArriveDate',
  派件司机: 'daName',
  派件司机所属供应商: 'courierVendor',
  最新扫描网点: 'lastScanSite',
  揽收司机名称: 'pickUpUserName',
  创建时间: 'createDate',
  揽收司机账号: 'pickUpUserCode',
  实收网点: 'actualReceiveStation',
  参考订单号: 'referenceNo',
  收件时间: 'receiveTime',
  预约派送日期: 'schedulePieDate',
  原运单号: 'referenceWaybillNo',
  揽件网点: 'receiveStation',
  收件门牌号: 'consigneeInternalNumber',
  最新扫描人: 'lastScanUserName',
  最新扫描类型: 'lastScanStatus',
  最新扫描时间: 'lastScanTime',
  最新问题件类型: 'problemType',
  最新问题件原因: 'problemReason',
  自提状态: 'pudoStatusDesc',
  交邮时间: 'shipmentRdcTime',
  退件状态: 'returnStatusStr',
  退件新单号: 'newWaybillNo',
  退件扫描时间: 'returnScanTime',
  退货最新扫描时间: 'newWaybillLastScanTime',
  退件最新扫描操作: 'newWaybillLastScanType',
  退件原因: 'returnReason',
  派件网点: 'dispatchStation',
  送货方式: 'deliveryMethodDesc',
  自提点: 'pointName',
  派件司机编号: 'daCode',
  派件司机所属供应商编码: 'courierVendorCode',
  拦截状态: 'interceptStatusStr',
  完结状态: 'closeStatusStr',
  完结时间: 'closeTime',
  配送状态: 'dispatchStatus',
  上架网点: 'ocName',
  库位编号: 'locationCode',
  退货处理方式: 'returnProcessingMethod',
  默认处理方式: 'defaultHandleMethodDesc',
  订单类型: 'orderType',
  收件人姓名: 'consigneeContact',
  收件省: 'consigneeProvince',
  收件市: 'consigneeCity',
  收件区: 'consigneeArea',
  邮编: 'consigneeZipCode',
  预派件网点编码: 'preDeliveryStationCode',
  提货网点: 'pickupStationName',
  派件供应商: 'deliveryCspVendorName',
  目的国入网时间: 'netWorkTime',
  件数: 'skuQty',
  '商家上传体积(cm³)': 'businessTotalVolume',
  商家上传重量: 'businessTotalWeight',
  '商家上传体积重量(kg)': 'businessVolumeWeight',
  收件总重量: 'pickupWeight',
  收件总体积: 'pickupVolume',
  '收件体积重量(kg)': 'pickupVolumeWeight',
  大小: 'intlBagSize',
  寄件国家: 'consignorCountry',
  寄件联系人: 'consignorContact',
  收件电话: 'consigneePhone',
  收件人详细地址: 'consigneeAddress',
  收件邮箱: 'consigneeEmail',
  收件国家: 'consigneeCountry',
  寄件网点: 'shippingStation',
  NDR状态: 'ndrStatus',
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 查询窗口足够宽，覆盖任意历史运单的下单日期，不依赖调用方传时间范围 */
function wideSearchWindow(): { startTime: string; endTime: string } {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const endDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  return { startTime: '2018-01-01 00:00:00', endTime: `${endDate} 23:59:59` }
}

function buildQueryContent(input: { waybillNos: string[]; startTime: string; endTime: string }): string {
  return JSON.stringify({
    waybillNos: input.waybillNos.join(','),
    referenceNos: '',
    labelOrderCodes: '',
    mainWaybillNos: '',
    platformNos: [],
    dateSearchType: 'waybill',
    startTime: input.startTime,
    endTime: input.endTime,
    actualReceiveStation: '',
    // 抓包原值是 UI 表格当时的分页状态（20），不是导出行数上限；
    // 如果这个任务真的按 showCount 截断导出结果，20 会在单批 1000 个单号时丢数据，
    // 所以这里改成与单批单号数对齐，避免命中数超过 20 时被静默截断
    showCount: WAYBILL_QUERY_BATCH_SIZE,
    currentPage: 1,
  })
}

/**
 * 按 waybillNo 批量查「中心运单查询」导出结果（自动按 1000/批分片 + 批间限速），
 * 返回原始多列记录（表头已转字段名，见 CENTER_WAYBILL_QUERY_COLUMN_MAP）。
 * 其他需要运单详情（不止供应商归属）的场景直接复用这个函数即可。
 */
export async function fetchCenterWaybillQueryRows(
  token: string,
  waybillNos: string[],
  options?: { startTime?: string; endTime?: string },
): Promise<{ ok: true; rows: Record<string, string>[] } | ImileExportJobError> {
  const uniqueNos = [...new Set(waybillNos.filter((no) => typeof no === 'string' && no.trim().length > 0))]
  if (uniqueNos.length === 0) return { ok: true, rows: [] }

  const normalizedToken = normalizeImileToken(token)
  const { startTime, endTime } = { ...wideSearchWindow(), ...options }
  const batches = chunkArray(uniqueNos, WAYBILL_QUERY_BATCH_SIZE)
  const rows: Record<string, string>[] = []

  for (let i = 0; i < batches.length; i += 1) {
    const result = await fetchImileExportRows(
      normalizedToken,
      PAGE,
      {
        jobType: 1,
        bizType: BIZ_TYPE,
        jobName: JOB_NAME,
        titles: TITLES_XML,
        queryContent: buildQueryContent({ waybillNos: batches[i], startTime, endTime }),
        moduleId: MODULE_ID,
      },
      CENTER_WAYBILL_QUERY_COLUMN_MAP,
    )
    if (!result.ok) {
      return { ok: false, status: result.status, message: `中心运单查询${result.message}`, rawText: result.rawText }
    }
    rows.push(...result.rows)
    if (i < batches.length - 1) await sleep(BATCH_DELAY_MS)
  }

  return { ok: true, rows }
}
