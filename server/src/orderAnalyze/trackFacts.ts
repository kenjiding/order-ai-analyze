import type { TrackEvent } from '../imile/track'
import type { ScanInterceptLog } from '../imile/interceptLogs'
import type {
  FirstAssignCancelDriver,
  LossResponsibilityOwner,
  ResponsibilitySegment,
  TrackFacts,
  WarehouseProfile,
} from './types'
import {
  DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS,
  classifyOperatorForWarehouse,
  findWarehouseProfileByName,
  getWarehouseLossTimeoutDays,
  isSharedWorkstationOperator,
  EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS,
} from './warehouseProfiles'

/** 写入模型提示时的轨迹类型中文说明；未列出的保留接口原值 */
const TRACK_TYPE_ZH_BY_EN = new Map<string, string>([
  ['schedule', '已预约进行派送'],
  ['delivery', '派送中'],
  ['problem', '登记为问题件'],
])

type InternalSegment = ResponsibilitySegment & {
  events: TrackEvent[]
  warehouseProfile: WarehouseProfile | null
}

type ResponsibilityPoint = {
  owner: LossResponsibilityOwner
  time: string
  basis: string
  source: 'track' | 'intercept'
}

function formatTrackTypeForAnalyzePrompt(raw: string): string {
  const tt = raw.trim()
  if (!tt) return ''
  return TRACK_TYPE_ZH_BY_EN.get(tt.toLowerCase()) ?? tt
}

export function summarizeTracks(tracks: TrackEvent[], maxEvents = 12): string {
  if (!tracks.length) return '（暂无轨迹节点）'
  const sorted = [...tracks].sort((a, b) => a.time.localeCompare(b.time))
  const tail = sorted.slice(-maxEvents)
  const lastTrack = sorted.at(-1) ?? null
  return tail
    .map((t) => {
      const parts: string[] = [t.time]
      const typeLabel = formatTrackTypeForAnalyzePrompt(t.trackType ?? '')
      if (typeLabel) parts.push(typeLabel)
      const tx = (t.trackStageTx ?? '').trim()
      if (tx && lastTrack && t.time === lastTrack.time) parts.push(tx)
      parts.push(t.content)
      return parts.join(' | ')
    })
    .join('\n')
}

function extractOperatorFromContent(content: string): string {
  const m = /操作员【([^\]】]+)】/.exec(content)
  return m ? m[1].trim() : ''
}

/**
 * 按时序识别「连续相邻」的 "分配→取消" 配对的最大次数。
 *
 * 只有首尾相接、中间不夹任何真实物理操作的分配-取消才算同一轮循环：一旦出现真实扫描员/派送员操作
 * （即能建立责任点的事件，与 getTrackResponsibilityPoint 同源），说明包裹被真实触达过，
 * 链条断开，计数归零。判定"是否为真实操作"必须走仓库画像，避免把 System 等非真实账号误当作打断。
 */
function countMaxConsecutiveAssignCancelPairs(
  sorted: TrackEvent[],
  profile: WarehouseProfile | null
): number {
  const isInterruptingEvent = (event: TrackEvent): boolean => {
    if (isProblemEvent(event) || isDeliveryCompletionEvent(event)) return true
    if (event.content.includes('订单异常完结')) return true
    return getTrackResponsibilityPoint(event, profile) !== null
  }

  let maxPairs = 0
  let currentPairs = 0
  let pendingAssign = false

  for (const ev of sorted) {
    const c = ev.content
    if (c.includes('派送任务已分配给派件员')) {
      pendingAssign = true
      continue
    }
    if (c.includes('取消分配') || c.includes('撤销分配')) {
      if (pendingAssign) {
        currentPairs += 1
        if (currentPairs > maxPairs) maxPairs = currentPairs
      } else {
        currentPairs = 0
      }
      pendingAssign = false
      continue
    }
    if (isInterruptingEvent(ev)) {
      pendingAssign = false
      currentPairs = 0
    }
  }
  return maxPairs
}

const ASSIGNED_DRIVER_NAME_RE = /派件员\s*[:：]\s*([^,，)）]+)/
const ASSIGNED_DRIVER_ID_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)/i
const CANCELLED_DRIVER_NAME_RE = /取消分配给\s*[[【]([^\]】]+)[\]】]/

function isDeliveryAssignEvent(event: TrackEvent): boolean {
  return event.content.includes('派送任务已分配给派件员')
}

function isDeliveryCancelEvent(event: TrackEvent): boolean {
  return event.content.includes('取消分配') || event.content.includes('撤销分配')
}

/**
 * 最后一次库内实物确认（inWarehouseStartTime）之后，第一个「分配→取消」配对的派件员。
 *
 * 取这个口径而不是「最早的分配」或「最长循环段的第一个」：盘点/回站意味着包裹在那一刻仍被
 * 实物确认在仓内，此前被分配又取消的司机已被洗清嫌疑（真实案例 3781059314407：08-05 盘点后
 * 才是嫌疑窗口，07-23 的司机无关）。锚点与子类型判定用的 dispatchAfterInWarehouseStart 同源。
 *
 * ⚠️ 只读扫描，产出仅用于展示，不参与任何判定。
 */
function findFirstAssignCancelDriverAfterInWarehouseStart(
  sorted: TrackEvent[],
  inWarehouseStartTime: string | null,
  profile: WarehouseProfile | null
): FirstAssignCancelDriver | null {
  const isInterruptingEvent = (event: TrackEvent): boolean => {
    if (isProblemEvent(event) || isDeliveryCompletionEvent(event)) return true
    if (event.content.includes('订单异常完结')) return true
    return getTrackResponsibilityPoint(event, profile) !== null
  }

  let pendingAssign: TrackEvent | null = null

  for (const event of sorted) {
    if (inWarehouseStartTime !== null && event.time <= inWarehouseStartTime) continue

    if (isDeliveryAssignEvent(event)) {
      // 连续两次分配未夹取消时，以最近一次分配为准（前一次分配被静默改派）
      pendingAssign = event
      continue
    }

    if (isDeliveryCancelEvent(event)) {
      if (!pendingAssign) continue
      const driverName = ASSIGNED_DRIVER_NAME_RE.exec(pendingAssign.content)?.[1]?.trim() ?? ''
      if (!driverName) {
        pendingAssign = null
        continue
      }
      return {
        driverName,
        driverId: ASSIGNED_DRIVER_ID_RE.exec(pendingAssign.content)?.[1]?.trim() ?? '',
        assignTime: pendingAssign.time,
        cancelTime: event.time,
        cancelDriverName: CANCELLED_DRIVER_NAME_RE.exec(event.content)?.[1]?.trim() ?? '',
      }
    }

    // 真实物理操作打断分配-取消链条，此前挂起的分配作废（与循环计数同源口径）
    if (isInterruptingEvent(event)) pendingAssign = null
  }

  return null
}

const STATION_LOSS_RE = /loss_in_the_station|station_loss|站点丢失|站内丢失|站内丢包/i
const MERCHANT_DESTROY_RE =
  /(商家已反馈NDR处理意见\[[^\]]*销毁[^\]]*])|(商家反馈意见\[[^\]]*销毁[^\]]*])|(包裹确认派送结束.*销毁)|(按(?:照)?商家反馈意见\[[^\]]*销毁[^\]]*]进行处理)/
const MERCHANT_STORAGE_RE =
  /(商家已反馈NDR处理意见\[[^\]]*暂存[^\]]*])|(商家反馈意见\[[^\]]*暂存[^\]]*])|(包裹确认派送结束.*暂存)|(按(?:照)?商家反馈意见\[[^\]]*暂存[^\]]*]进行处理)/
const MERCHANT_RETURN_RE =
  /(退件已退返商家)|(已退返商家)|(退回(?:发件方|寄件方|商家|卖家).*(?:签收|已签收|妥投|完成))|((?:退货|退件|退回).*(?:妥投|签收|已签收|完成))|((?:商家|发件方|寄件方|卖家).*(?:签收|已签收))|(退款退货闭环)/
/**
 * 商家 Abandon 方向信号：退件处理意见[Abandon] 或 NDR处理意见[Abandon]。
 * 注意：大小写不敏感，Abandon 是英文关键字，与中文"销毁"语义等同。
 */
const MERCHANT_ABANDON_FEEDBACK_RE =
  /(商家已反馈退件处理意见\[Abandon\])|(商家已反馈NDR处理意见\[Abandon\])|(商家反馈(?:退件|NDR)处理意见\[Abandon\])|(按(?:照)?商家反馈意见\[Abandon\]进行处理)|(包裹确认派送结束.*\[Abandon\])/i
/** 物理销毁闭环信号：包裹实际已被销毁 */
const MERCHANT_ABANDON_CLOSED_RE = /退件已销毁/
const TRANSFER_DESTINATION_RE = /(?:已装箱|完成待转发件)[^。]*目的地【([^】]+)】/
const BOXED_TRANSFER_RE = /(?:已装箱|完成待转发件)[^。]*目的地【[^】]+】/
const SORTER_DEVICE_SCAN_RE = /操作[员人]【\s*sorter\s*】/i
const DEVICE_CODE_RE = /设备编码\[[^\]]+\]/
const SORTER_CHUTE_ASSIGN_RE = /实际格口号为【[^】]+】/
const SYD_WAREHOUSE_OPERATOR_RE = /^SYD Warehouse\d+$/i
const NSYD_W_OPERATOR_RE = /^NSYD W\d+$/i
const LEADING_HUB_RE = /^【([^】]+)】/
const EXTERNAL_CARRIER_RE = /包裹已转交至【([^】]+)】进行承运/
const DELIVERY_COMPLETION_RE = /(已签收|签收成功|签收完成|妥投|派件完成|投递完成|投递成功|delivery\s*completed|delivered)/i
const DELIVERY_COMPLETION_NEGATIVE_RE = /(未签收|签收失败|未妥投|妥投失败|投递失败|派件失败|delivery\s*failed|not\s*delivered)/i
const ORDER_EXCEPTION_CLOSED_RE = /订单异常完结[，,]\s*原因【[^】]+】[。.]?\s*操作员【[^】]+】/

function normalizeHubName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

function extractTransferDestination(content: string): string {
  const hit = content.match(TRANSFER_DESTINATION_RE)
  return hit?.[1]?.trim() ?? ''
}

function extractLeadingHubName(content: string): string {
  const hit = content.match(LEADING_HUB_RE)
  return hit?.[1]?.trim() ?? ''
}

function extractExternalCarrierName(content: string): string {
  const hit = content.match(EXTERNAL_CARRIER_RE)
  return hit?.[1]?.trim() ?? ''
}

function isExternalCarrierOperator(operatorName: string, carrierName: string | null): boolean {
  const operator = normalizeHubName(operatorName)
  const carrier = normalizeHubName(carrierName ?? '')
  if (!operator || !carrier) return false
  return operator.includes(carrier) || carrier.includes(operator)
}

function extractMerchantDestroyEvidence(content: string): string {
  const hit = content.match(MERCHANT_DESTROY_RE)
  if (hit && hit[0]) return hit[0]
  return content.length > 60 ? `${content.slice(0, 60)}...` : content
}

function extractMerchantStorageEvidence(content: string): string {
  const hit = content.match(MERCHANT_STORAGE_RE)
  if (hit && hit[0]) return hit[0]
  return content.length > 60 ? `${content.slice(0, 60)}...` : content
}

function extractMerchantReturnEvidence(content: string): string {
  const hit = content.match(MERCHANT_RETURN_RE)
  if (hit && hit[0]) return hit[0]
  return content.length > 60 ? `${content.slice(0, 60)}...` : content
}

function extractShortEvidence(content: string): string {
  return content.length > 60 ? `${content.slice(0, 60)}...` : content
}

function isMerchantDestroyTerminalEvent(content: string): boolean {
  if (!content.includes('销毁')) return false
  return (
    content.includes('商家已反馈NDR处理意见') ||
    content.includes('商家反馈意见') ||
    content.includes('包裹确认派送结束') ||
    content.includes('按照商家反馈意见') ||
    content.includes('按商家反馈意见')
  )
}

/** 商家 Abandon 方向事件：退件/NDR处理意见[Abandon] */
function isMerchantAbandonFeedbackEvent(content: string): boolean {
  return MERCHANT_ABANDON_FEEDBACK_RE.test(content)
}

/** 物理销毁闭环事件：退件已销毁 */
function isMerchantAbandonClosedEvent(content: string): boolean {
  return MERCHANT_ABANDON_CLOSED_RE.test(content)
}

function isMerchantStorageEvent(content: string): boolean {
  if (!content.includes('暂存')) return false
  return (
    content.includes('商家已反馈NDR处理意见') ||
    content.includes('商家反馈意见') ||
    content.includes('包裹确认派送结束') ||
    content.includes('按照商家反馈意见') ||
    content.includes('按商家反馈意见')
  )
}

function isMerchantReturnEvent(content: string): boolean {
  if (!/(退件|退货|退回|商家|发件方|寄件方|卖家|退款|签收|妥投)/.test(content)) return false
  return MERCHANT_RETURN_RE.test(content)
}

function isMerchantReturnRequestEvent(content: string): boolean {
  if (isMerchantReturnEvent(content) || isMerchantDestroyTerminalEvent(content) || isMerchantStorageEvent(content)) {
    return false
  }
  // Abandon 是独立的商家反馈类型，不归入退返方向
  if (isMerchantAbandonFeedbackEvent(content) || isMerchantAbandonClosedEvent(content)) {
    return false
  }
  if (/(商家已反馈NDR处理意见|商家反馈NDR处理意见|包裹确认派送结束|按照商家反馈意见|按商家反馈意见)/.test(content)) {
    return /(退返商家|退回商家)/.test(content)
  }
  return (
    content.includes('商家已反馈退件处理意见') ||
    content.includes('商家反馈退件处理意见') ||
    content.includes('商家要求退回')
  )
}

function isMerchantReturnDirectionRequestEvent(content: string): boolean {
  return isMerchantReturnRequestEvent(content) && /(退返商家|退回商家)/.test(content)
}

function isMerchantReturnProgressEvent(content: string): boolean {
  return (
    isMerchantReturnRequestEvent(content) ||
    isBoxedTransferEvent(content) ||
    content.includes('开始退回') ||
    content.includes('退件中')
  )
}

/**
 * 「【AAAA】已装箱（集包），目的地【BBBB】」属于起始仓 AAAA 的最后一次库内真实操作。
 * 它不代表责任已离开 AAAA：在目的仓 BBBB 出现真实操作（轨迹到达 / 阻断扫描）之前，责任仍归 AAAA。
 */
function isBoxedTransferEvent(content: string): boolean {
  return BOXED_TRANSFER_RE.test(content)
}

function isSorterDeviceScanEvent(content: string): boolean {
  if (!SORTER_DEVICE_SCAN_RE.test(content)) return false
  return DEVICE_CODE_RE.test(content) || SORTER_CHUTE_ASSIGN_RE.test(content)
}

/** sorter 分拣格口扫描事件：展示层用它把「最新责任操作」显示为固定短标签「格口」 */
export function isSorterChuteAssignmentEvent(content: string): boolean {
  return SORTER_DEVICE_SCAN_RE.test(content) && SORTER_CHUTE_ASSIGN_RE.test(content)
}

function isSydneyWarehouseOperator(name: string): boolean {
  return SYD_WAREHOUSE_OPERATOR_RE.test(name.trim())
}

function isNorthSydneyWarehouseOperator(name: string): boolean {
  return NSYD_W_OPERATOR_RE.test(name.trim())
}

function isSydneyInternalWarehouseResetEvent(event: TrackEvent, profile: WarehouseProfile | null): boolean {
  if (profile?.cityId !== 'SYD') return false
  if (isSorterDeviceScanEvent(event.content)) return true

  const operatorName = extractOperatorFromContent(event.content)
  if (isSydneyWarehouseOperator(operatorName)) {
    return (
      event.content.includes('已装箱') ||
      event.content.includes('完成待转发件') ||
      event.content.includes('包裹已发往') ||
      event.content.includes('车辆') ||
      event.content.includes('已到达')
    )
  }

  return isNorthSydneyWarehouseOperator(operatorName) && isWarehouseArrivalEvent(event)
}

function isDeliveryScheduleEvent(t: TrackEvent): boolean {
  const content = t.content
  const stage = t.trackStageTx ?? ''
  const trackType = (t.trackType ?? '').trim().toLowerCase()
  return (
    trackType === 'schedule' ||
    content.includes('预约派送') ||
    content.includes('预约进行派送') ||
    stage.includes('预约派送') ||
    stage.includes('预约进行派送')
  )
}

function isPostStorageBusinessProgressEvent(t: TrackEvent): boolean {
  const content = t.content
  return (
    isMerchantReturnEvent(content) ||
    isMerchantAbandonFeedbackEvent(content) ||  // Abandon 方向使暂存失效
    isMerchantAbandonClosedEvent(content) ||     // 退件已销毁使暂存失效
    content.includes('商家已反馈退件处理意见') ||
    content.includes('商家反馈退件处理意见') ||
    content.includes('已装箱')
  )
}

function hasTrackType(t: TrackEvent, type: string): boolean {
  return (t.trackType ?? '').trim().toLowerCase() === type
}

function isDispatchOutEvent(t: TrackEvent): boolean {
  return t.content.includes('包裹正在派送中') || hasTrackType(t, 'delivery')
}

function hasDeliveryCompletionKeyword(text: string): boolean {
  return DELIVERY_COMPLETION_RE.test(text)
}

function hasDeliveryCompletionNegativeKeyword(text: string): boolean {
  return DELIVERY_COMPLETION_NEGATIVE_RE.test(text)
}

function isDeliveryCompletionEvent(t: TrackEvent): boolean {
  const stage = (t.trackStageTx ?? '').trim()
  const content = (t.content ?? '').trim()
  const candidates = [stage, content].filter((text) => text.length > 0)
  if (!candidates.length) return false
  if (candidates.some((text) => hasDeliveryCompletionNegativeKeyword(text))) return false
  return candidates.some((text) => hasDeliveryCompletionKeyword(text))
}

function isOrderExceptionClosedEvent(t: TrackEvent): boolean {
  return ORDER_EXCEPTION_CLOSED_RE.test((t.content ?? '').trim())
}

function isReturnOrInventoryEvent(t: TrackEvent): boolean {
  return t.content.includes('已回到网点') || t.content.includes('已盘点') || t.content.includes('已归班')
}

function isProblemEvent(t: TrackEvent): boolean {
  return t.content.includes('登记问题件') || hasTrackType(t, 'problem')
}

/**
 * 外部承运商将包裹退回仓库的入仓确认事件。
 * 例："【Sydney Center】已收到【Australia Fastway】退回包裹" 或 "已收到退件包裹"。
 * 此类事件与 isReturnOrInventoryEvent 中的「已回到网点/已盘点」地位等同：
 * 物理包裹到仓已由平台记录确认，不依赖操作员账号类型即可建立库内责任起算点。
 */
function isReturnFromCarrierArrivalEvent(content: string): boolean {
  return (content.includes('已收到') && content.includes('退回包裹')) || content.includes('已收到退件包裹')
}

function isWarehouseArrivalEvent(t: TrackEvent): boolean {
  const c = t.content
  return (
    c.includes('已到达') ||
    c.includes('已收到退件包裹') ||
    (c.includes('已收到') && c.includes('退回包裹'))
  )
}

function isWarehousePhysicalResponsibilityEvent(t: TrackEvent): boolean {
  return (
    isWarehouseArrivalEvent(t) ||
    isReturnOrInventoryEvent(t) ||
    t.content.includes('已下架') ||
    t.content.includes('已揽收')
  )
}

function summarizeLatestEvent(t: TrackEvent): string {
  const c = t.content
  if (isOrderExceptionClosedEvent(t)) return '订单异常完结（最新轨迹终态）'
  if (isDeliveryCompletionEvent(t)) return '已签收/妥投（完结）'
  if (isDispatchOutEvent(t)) return '派送中（在途，包裹已出库）'
  if (c.includes('包裹已转交至')) return c.slice(0, 40)
  if (isBoxedTransferEvent(c)) return `${c.slice(0, 40)}（起始仓装箱集包，责任暂留起始仓待目的仓接收）`
  if (c.includes('已到达')) return c.slice(0, 40)
  if (c.includes('已回到网点')) return '派件员已回到网点（在库）'
  if (c.includes('已盘点')) return '已盘点（在库）'
  if (c.includes('派送任务已分配给派件员'))
    return '派送任务已分配（在库内待派送员二次扫描出库）'
  if (c.includes('取消分配') || c.includes('撤销分配')) return '派送任务已取消（仍在库内）'
  if (isProblemEvent(t)) return '登记为问题件'
  if (c.includes('订单异常完结') && STATION_LOSS_RE.test(c))
    return '订单异常完结（承运商已标记站内丢包，仅作辅助证据）'
  if (c.includes('订单异常完结')) return '订单异常完结（原因需结合上下文判断）'
  if (c.includes('包裹正在处理中')) return '包裹处理中（状态模糊）'
  return t.content.slice(0, 40)
}

function isValidTimeString(timeStr: string): boolean {
  return !Number.isNaN(new Date(timeStr).getTime())
}

function latestParseableInterceptLog(interceptLogs: ScanInterceptLog[]): ScanInterceptLog | null {
  const parseable = interceptLogs.filter((log) => isValidTimeString(log.gmtIntercept))
  if (!parseable.length) return null
  return parseable.sort((a, b) => a.gmtIntercept.localeCompare(b.gmtIntercept)).at(-1) ?? null
}

function interceptOperatorLabel(type: TrackFacts['latestInterceptOperatorType']): string {
  if (type === 'courier') return '派送员'
  if (type === 'scanner') return '当前仓库扫描员'
  if (type === 'unknown') return '未知操作人'
  return '无'
}

function isInterceptAfter(interceptTime: string | null, basisTime: string | null): boolean {
  return Boolean(interceptTime && basisTime && interceptTime > basisTime)
}

function responsibilityOwnerLabel(owner: LossResponsibilityOwner): string {
  return owner === 'in_warehouse' ? '库内' : '库外'
}

function getTrackResponsibilityPoint(
  event: TrackEvent,
  profile: WarehouseProfile | null
): ResponsibilityPoint | null {
  if (isMerchantReturnEvent(event.content)) return null

  if (isBoxedTransferEvent(event.content)) {
    const operatorName = extractOperatorFromContent(event.content)
    if (classifyOperatorForWarehouse(operatorName, profile) !== 'real') return null
    return {
      owner: 'in_warehouse',
      time: event.time,
      basis: `正常轨迹真实操作员 ${operatorName} 装箱集包责任点（${event.time}）`,
      source: 'track',
    }
  }

  if (isDispatchOutEvent(event)) {
    return {
      owner: 'out_warehouse',
      time: event.time,
      basis: `正常轨迹「包裹正在派送中」二次扫描出库（${event.time}）`,
      source: 'track',
    }
  }

  if (isReturnOrInventoryEvent(event)) {
    const label = event.content.includes('已回到网点')
      ? '已回到网点'
      : event.content.includes('已归班')
        ? '已归班'
        : '已盘点'
    return {
      owner: 'in_warehouse',
      time: event.time,
      basis: `正常轨迹「${label}」回仓/盘点责任点（${event.time}）`,
      source: 'track',
    }
  }

  if (isReturnFromCarrierArrivalEvent(event.content)) {
    return {
      owner: 'in_warehouse',
      time: event.time,
      basis: `正常轨迹外部承运商退件入仓确认责任点（${event.time}）`,
      source: 'track',
    }
  }

  if (event.content.includes('已到达')) {
    const arrivalOperatorName = extractOperatorFromContent(event.content)
    if (isSharedWorkstationOperator(arrivalOperatorName, profile)) {
      return {
        owner: 'in_warehouse',
        time: event.time,
        basis: `正常轨迹共享工位账号 ${arrivalOperatorName} 到仓确认责任点（${event.time}）`,
        source: 'track',
      }
    }
  }

  if (isSydneyInternalWarehouseResetEvent(event, profile)) {
    return {
      owner: 'in_warehouse',
      time: event.time,
      basis: `正常轨迹悉尼分拣/内部转仓真实扫描责任点（${event.time}）`,
      source: 'track',
    }
  }

  if (isSorterDeviceScanEvent(event.content)) {
    return {
      owner: 'in_warehouse',
      time: event.time,
      basis: `正常轨迹 sorter 设备真实扫描责任点（${event.time}）`,
      source: 'track',
    }
  }

  if (!isWarehousePhysicalResponsibilityEvent(event)) return null

  const operatorName = extractOperatorFromContent(event.content)
  if (classifyOperatorForWarehouse(operatorName, profile) !== 'real') return null
  return {
    owner: 'in_warehouse',
    time: event.time,
    basis: `正常轨迹真实操作员 ${operatorName} 扫描责任点（${event.time}）`,
    source: 'track',
  }
}

/**
 * 判断阻断日志是否归属当前责任仓：
 * - 无法从 scanOcName 解析仓库（含历史无网点字段的日志）→ 视为归当前责任仓（向后兼容）；
 * - 能解析且与当前责任仓同仓 → 归当前责任仓；
 * - 能解析但属于其他仓 → 不归当前段（应由 reconcileSegmentsWithInterceptArrivals 切换为该仓责任段后再计入）。
 */
function interceptBelongsToActiveHub(
  interceptLog: ScanInterceptLog,
  activeSegment: InternalSegment
): boolean {
  const hubProfile = findWarehouseProfileByName(interceptLog.scanOcName ?? '')
  if (!hubProfile || !activeSegment.hubId) return true
  return hubProfile.hubId === activeSegment.hubId
}

function getInterceptResponsibilityPoint(
  interceptLog: ScanInterceptLog | null,
  activeSegment: InternalSegment | null
): ResponsibilityPoint | null {
  if (!interceptLog || !isValidTimeString(interceptLog.gmtIntercept)) return null
  if (activeSegment?.owner !== 'company_warehouse') return null
  if (interceptLog.gmtIntercept < activeSegment.startTime) return null
  if (!interceptBelongsToActiveHub(interceptLog, activeSegment)) return null

  if (interceptLog.operatorType === 'courier') {
    return {
      owner: 'out_warehouse',
      time: interceptLog.gmtIntercept,
      basis: `阻断日志派送员 ${interceptLog.scanUserName || interceptLog.scanUserCode || '-'} 扫描责任点（${interceptLog.gmtIntercept}）`,
      source: 'intercept',
    }
  }

  if (interceptLog.operatorType === 'scanner') {
    return {
      owner: 'in_warehouse',
      time: interceptLog.gmtIntercept,
      basis: `阻断日志当前仓库扫描员 ${interceptLog.scanUserName || interceptLog.scanUserCode || '-'} 扫描责任点（${interceptLog.gmtIntercept}）`,
      source: 'intercept',
    }
  }

  return null
}

function findLastResponsibilityPoint(points: ResponsibilityPoint[]): ResponsibilityPoint | null {
  if (!points.length) return null
  return [...points].sort((a, b) => a.time.localeCompare(b.time)).at(-1) ?? null
}

function findLastResponsibilityPointByOwner(
  points: ResponsibilityPoint[],
  owner: LossResponsibilityOwner
): ResponsibilityPoint | null {
  return findLastResponsibilityPoint(points.filter((point) => point.owner === owner))
}

function hasSameHub(segment: InternalSegment | null, hubName: string): boolean {
  if (!segment?.hubName) return false
  return normalizeHubName(segment.hubName) === normalizeHubName(hubName)
}

function toPublicSegment(segment: InternalSegment): ResponsibilitySegment {
  return {
    owner: segment.owner,
    status: segment.status,
    startTime: segment.startTime,
    endTime: segment.endTime,
    startReason: segment.startReason,
    endReason: segment.endReason,
    hubId: segment.hubId,
    hubName: segment.hubName,
    cityId: segment.cityId,
    warehouseKnown: segment.warehouseKnown,
    carrierName: segment.carrierName,
    eventCount: segment.eventCount,
  }
}

function makeSegment(input: {
  owner: InternalSegment['owner']
  status: InternalSegment['status']
  startTime: string
  startReason: string
  hubName?: string
  carrierName?: string
}): InternalSegment {
  const profile = input.hubName ? findWarehouseProfileByName(input.hubName) : null
  return {
    owner: input.owner,
    status: input.status,
    startTime: input.startTime,
    endTime: null,
    startReason: input.startReason,
    endReason: null,
    hubId: profile?.hubId ?? null,
    hubName: input.hubName || null,
    cityId: profile?.cityId ?? null,
    warehouseKnown: Boolean(profile),
    carrierName: input.carrierName ?? null,
    eventCount: 0,
    events: [],
    warehouseProfile: profile,
  }
}

function closeSegment(segment: InternalSegment | null, endTime: string, reason: string): void {
  if (!segment || segment.endTime) return
  segment.endTime = endTime
  segment.endReason = reason
}

function pushEvent(segment: InternalSegment, event: TrackEvent): void {
  segment.events.push(event)
  segment.eventCount = segment.events.length
}

function buildResponsibilitySegments(sorted: TrackEvent[]): InternalSegment[] {
  const segments: InternalSegment[] = []
  let active: InternalSegment | null = null

  const appendSegment = (segment: InternalSegment): InternalSegment => {
    segments.push(segment)
    return segment
  }

  const ensureWarehouseSegment = (event: TrackEvent, hubName: string, reason: string): InternalSegment => {
    if (active && active.owner === 'company_warehouse' && hasSameHub(active, hubName)) return active
    closeSegment(active, event.time, reason)
    active = appendSegment(
      makeSegment({
        owner: 'company_warehouse',
        status: 'in_warehouse',
        startTime: event.time,
        startReason: reason,
        hubName,
      })
    )
    return active
  }

  for (const event of sorted) {
    const leadingHub = extractLeadingHubName(event.content)
    const destination = extractTransferDestination(event.content)
    const carrierName = extractExternalCarrierName(event.content)
    const operatorName = extractOperatorFromContent(event.content)

    if (
      active?.owner === 'external_carrier' &&
      leadingHub &&
      isExternalCarrierOperator(operatorName, active.carrierName)
    ) {
      pushEvent(active, event)
      continue
    }

    if (carrierName) {
      const hubName = leadingHub || (active ? active.hubName ?? '' : '')
      if (hubName) ensureWarehouseSegment(event, hubName, '仓库转交外部承运前定位责任仓')
      if (!active) {
        active = appendSegment(
          makeSegment({
            owner: 'unknown',
            status: 'unknown',
            startTime: event.time,
            startReason: '无法识别外部承运交接前责任仓',
          })
        )
      }
      const closingSegment = active
      pushEvent(closingSegment, event)
      closeSegment(closingSegment, event.time, `已转交外部承运商 ${carrierName}`)
      active = appendSegment(
        makeSegment({
          owner: 'external_carrier',
          status: 'external_carrier',
          startTime: event.time,
          startReason: `由 ${hubName || '未知仓库'} 转交外部承运商 ${carrierName}`,
          carrierName,
        })
      )
      pushEvent(active, event)
      continue
    }

    if (destination) {
      // 「【AAAA】已装箱集包，目的地【BBBB】」是起始仓 AAAA 的最后一次库内操作；
      // 在目的仓 BBBB 出现真实操作（轨迹到达 / 阻断扫描）之前，责任仍留在 AAAA，不另开转运责任真空段。
      const originHub = leadingHub || (active ? active.hubName ?? '' : '')
      if (originHub) {
        ensureWarehouseSegment(event, originHub, '装箱集包转运，责任留在起始仓直至目的仓产生真实操作')
      } else if (!active) {
        active = appendSegment(
          makeSegment({
            owner: 'unknown',
            status: 'unknown',
            startTime: event.time,
            startReason: '装箱转运但无法识别起始仓',
          })
        )
      }
      if (active) pushEvent(active, event)
      continue
    }

    if (leadingHub) {
      // 装箱集包转运后，目的仓出现真实库内物理操作（到达/收退件/盘点/归班/回网点/下架/揽收）即视为已到达该仓，切换责任段。
      const canLocateWarehouse =
        !active ||
        active.owner === 'unknown' ||
        (active.owner === 'company_warehouse' && isWarehousePhysicalResponsibilityEvent(event)) ||
        (active.owner === 'company_warehouse' && hasSameHub(active, leadingHub)) ||
        (active.owner === 'external_carrier' && isWarehousePhysicalResponsibilityEvent(event))

      if (canLocateWarehouse) {
        ensureWarehouseSegment(
          event,
          leadingHub,
          isWarehouseArrivalEvent(event) ? '到达仓库' : '仓库轨迹定位'
        )
      }
    } else if (!active) {
      active = appendSegment(
        makeSegment({
          owner: 'unknown',
          status: 'unknown',
          startTime: event.time,
          startReason: '轨迹未提供仓库信息',
        })
      )
    }

    if (!active) continue
    pushEvent(active, event)

    if (active.owner === 'company_warehouse') {
      if (isDispatchOutEvent(event)) active.status = 'out_warehouse'
      if (isReturnOrInventoryEvent(event)) active.status = 'in_warehouse'
    }
  }

  return segments
}

function findLastEvent(events: TrackEvent[], predicate: (event: TrackEvent) => boolean): TrackEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (predicate(events[i])) return events[i]
  }
  return null
}

function findFirstRealScan(events: TrackEvent[], profile: WarehouseProfile | null): TrackEvent | null {
  for (const event of events) {
    if (isSorterDeviceScanEvent(event.content)) return event
    if (isReturnFromCarrierArrivalEvent(event.content)) return event
    const op = extractOperatorFromContent(event.content)
    if (event.content.includes('已到达') && isSharedWorkstationOperator(op, profile)) return event
    if (classifyOperatorForWarehouse(op, profile) !== 'real') continue
    if (
      isBoxedTransferEvent(event.content) ||
      isWarehousePhysicalResponsibilityEvent(event) ||
      isSydneyInternalWarehouseResetEvent(event, profile)
    ) {
      return event
    }
  }
  return null
}

function findLastRealScan(events: TrackEvent[], profile: WarehouseProfile | null): TrackEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (isSorterDeviceScanEvent(event.content)) return event
    if (isReturnFromCarrierArrivalEvent(event.content)) return event
    const op = extractOperatorFromContent(event.content)
    if (event.content.includes('已到达') && isSharedWorkstationOperator(op, profile)) return event
    if (classifyOperatorForWarehouse(op, profile) !== 'real') continue
    if (
      isBoxedTransferEvent(event.content) ||
      isWarehousePhysicalResponsibilityEvent(event) ||
      isSydneyInternalWarehouseResetEvent(event, profile)
    ) {
      return event
    }
  }
  return null
}

function findInboundSameCityRealScan(
  segments: InternalSegment[],
  activeSegment: InternalSegment | null
): TrackEvent | null {
  if (
    !activeSegment ||
    activeSegment.owner !== 'company_warehouse' ||
    !activeSegment.cityId ||
    !activeSegment.warehouseProfile
  ) {
    return null
  }

  const upstream = segments[segments.indexOf(activeSegment) - 1]
  if (
    !upstream ||
    upstream.owner !== 'company_warehouse' ||
    upstream.cityId !== activeSegment.cityId ||
    !upstream.warehouseProfile
  ) {
    return null
  }

  if (upstream.endTime !== activeSegment.startTime) return null

  return findLastRealScan(upstream.events, upstream.warehouseProfile)
}

/** 阻断日志按其扫描网点画像判定库内/库外操作归属：派送员→库外、该仓真实扫描员→库内、其余→无效。 */
function interceptHubOpOwner(
  interceptLog: ScanInterceptLog,
  hubProfile: WarehouseProfile
): LossResponsibilityOwner | null {
  if (interceptLog.scanUserCode.startsWith('D')) return 'out_warehouse'
  if (classifyOperatorForWarehouse(interceptLog.scanUserName, hubProfile) === 'real') return 'in_warehouse'
  return null
}

/**
 * 用阻断日志补全"责任仓切换"：当目的仓/其他仓出现真实操作（扫描网点 + 真实扫描员/派送员），
 * 即便轨迹没有「已到达」事件，也据此把责任段切换到该仓，对应"轨迹停更但阻断日志有操作"的定责场景。
 */
function reconcileSegmentsWithInterceptArrivals(
  segments: InternalSegment[],
  interceptLogs: ScanInterceptLog[]
): InternalSegment[] {
  if (!segments.length) return segments
  const sortedLogs = interceptLogs
    .filter((log) => isValidTimeString(log.gmtIntercept))
    .sort((a, b) => a.gmtIntercept.localeCompare(b.gmtIntercept))

  for (const log of sortedLogs) {
    const active = segments[segments.length - 1]
    if (!active) break
    // 外部承运交接是显式语义，不被阻断日志覆盖
    if (active.owner === 'external_carrier') continue
    const hubProfile = findWarehouseProfileByName(log.scanOcName ?? '')
    if (!hubProfile) continue
    if (log.gmtIntercept <= active.startTime) continue
    // 已经是同一个公司仓责任段，无需切换（库内/库外责任点由 getInterceptResponsibilityPoint 计入）
    if (active.owner === 'company_warehouse' && active.hubId === hubProfile.hubId) continue
    const op = interceptHubOpOwner(log, hubProfile)
    if (!op) continue
    closeSegment(active, log.gmtIntercept, `阻断日志显示已在 ${hubProfile.name} 操作`)
    segments.push(
      makeSegment({
        owner: 'company_warehouse',
        status: op === 'out_warehouse' ? 'out_warehouse' : 'in_warehouse',
        startTime: log.gmtIntercept,
        startReason: `阻断日志 ${log.scanUserName || log.scanUserCode} 在 ${hubProfile.name} 的真实操作，责任转入该仓`,
        hubName: hubProfile.name,
      })
    )
  }
  return segments
}

function countEvents(events: TrackEvent[], predicate: (event: TrackEvent) => boolean): number {
  return events.reduce((sum, event) => sum + (predicate(event) ? 1 : 0), 0)
}

function makeEmptyFacts(input: {
  todayStr: string
  latestIntercept: ScanInterceptLog | null
  interceptLogs: ScanInterceptLog[]
}): TrackFacts {
  return {
    todayStr: input.todayStr,
    lastEventTime: '',
    lastEventDaysDiff: -1,
    responsibilitySegments: [],
    activeSegment: null,
    activeResponsibilityOwner: 'unknown',
    activeSegmentStatus: 'unknown',
    activeWarehouseHubId: null,
    activeWarehouseName: null,
    activeWarehouseCityId: null,
    activeWarehouseKnown: false,
    activeWarehouseLossTimeoutDays: DEFAULT_WAREHOUSE_LOSS_TIMEOUT_DAYS,
    externalCarrierLossTimeoutDays: EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS,
    activeExternalCarrierName: null,
    activeSegmentStartTime: null,
    activeSegmentDaysDiff: -1,
    unknownWarehouseInActiveSegment: false,
    externalCarrierTransferTime: null,
    externalCarrierDaysDiff: -1,
    inWarehouseStartTime: null,
    inWarehouseBasis: null,
    inWarehouseDaysDiff: -1,
    inWarehouseStartSupersededByDispatch: false,
    hasDeliveryCancellations: false,
    hasRealOperatorScan: false,
    hasDeliveryCompletion: false,
    deliveryCompletionTime: null,
    deliveryCompletionEvidence: null,
    latestOrderExceptionClosed: false,
    latestOrderExceptionClosedTime: null,
    latestOrderExceptionClosedEvidence: null,
    lastDispatchedOutTime: null,
    outWarehouseDaysDiff: -1,
    lastDispatchHasReturn: false,
    latestAssignmentAfterLastDispatch: false,
    deliveryAssignmentCount: 0,
    deliveryCancelCount: 0,
    problemCount: 0,
    lastInventoryTime: null,
    lastInventoryDaysDiff: -1,
    assignCancelLoopWithoutDispatch: false,
    firstAssignCancelDriver: null,
    stationLossCompletion: false,
    hasInterceptLogs: input.interceptLogs.length > 0,
    latestInterceptTime: input.latestIntercept?.gmtIntercept ?? null,
    latestInterceptUserCode: input.latestIntercept?.scanUserCode ?? null,
    latestInterceptUserName: input.latestIntercept?.scanUserName ?? null,
    latestInterceptOperatorType: input.latestIntercept?.operatorType ?? null,
    latestInterceptAfterInWarehouseStart: false,
    latestInterceptAfterOutWarehouseStart: false,
    interceptAdjustedResponsibilityOwner: null,
    interceptAdjustedResponsibilityStartTime: null,
    interceptAdjustedResponsibilityDaysDiff: -1,
    interceptAdjustedResponsibilityBasis: null,
    finalResponsibilityOwner: null,
    finalResponsibilityStartTime: null,
    finalResponsibilitySource: null,
    finalResponsibilityDaysDiff: -1,
    finalResponsibilityBasis: null,
    merchantDestroyConfirmed: false,
    merchantDestroyConfirmTime: null,
    merchantDestroyEvidence: null,
    merchantAbandonActive: false,
    merchantAbandonConfirmTime: null,
    merchantAbandonEvidence: null,
    merchantAbandonClosed: false,
    merchantAbandonClosedTime: null,
    merchantAbandonClosedEvidence: null,
    merchantStorageActive: false,
    merchantStorageConfirmTime: null,
    merchantStorageEvidence: null,
    merchantStorageReleasedBySchedule: false,
    merchantStorageScheduleTime: null,
    merchantStorageSupersededByBusinessProgress: false,
    merchantStorageBusinessProgressTime: null,
    merchantStorageBusinessProgressEvidence: null,
    hasPhysicalActivityAfterDirectionFeedback: false,
    merchantReturnClosed: false,
    merchantReturnClosedTime: null,
    merchantReturnClosedEvidence: null,
    merchantReturnDirectionActive: false,
    merchantReturnRequested: false,
    merchantReturnRequestTime: null,
    merchantReturnRequestDaysDiff: -1,
    merchantReturnRequestEvidence: null,
    merchantReturnLatestProgressTime: null,
    merchantReturnLatestProgressDaysDiff: -1,
    merchantReturnLatestProgressEvidence: null,
    merchantReturnTransferInProgress: false,
    latestEventKind: '',
  }
}

/**
 * 从轨迹事件中提取结构化事实（纯计算，无 I/O）。
 * 先解析当前责任段，再只基于当前责任段计算库内/库外时效。
 */
export function deriveTrackFacts(
  tracks: TrackEvent[],
  interceptLogs: ScanInterceptLog[] = [],
  options: { analysisDate?: string | Date } = {}
): TrackFacts {
  const today = options.analysisDate ? new Date(options.analysisDate) : new Date()
  if (isNaN(today.getTime())) {
    today.setTime(Date.now())
  }
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)

  function daysDiff(timeStr: string): number {
    const d = new Date(timeStr)
    if (isNaN(d.getTime())) return -1
    d.setHours(0, 0, 0, 0)
    return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86400000))
  }

  const sorted = [...tracks].sort((a, b) => a.time.localeCompare(b.time))
  const latestIntercept = latestParseableInterceptLog(interceptLogs)

  if (!sorted.length) {
    return makeEmptyFacts({ todayStr, latestIntercept, interceptLogs })
  }

  const lastEvent = sorted[sorted.length - 1]
  const latestOrderExceptionClosed = isOrderExceptionClosedEvent(lastEvent)
  const latestOrderExceptionClosedEvidence = latestOrderExceptionClosed ? extractShortEvidence(lastEvent.content) : null
  const segments = reconcileSegmentsWithInterceptArrivals(buildResponsibilitySegments(sorted), interceptLogs)
  const activeSegment = segments.at(-1) ?? null
  const activeEvents = activeSegment?.events ?? []
  const activeProfile = activeSegment?.warehouseProfile ?? null
  const isActiveCompanyWarehouse = activeSegment?.owner === 'company_warehouse'
  const shouldComputeWarehouseFacts = isActiveCompanyWarehouse

  let firstRealScan: TrackEvent | null = null
  let firstRealScanBasisLabel: string | null = null
  let lastDispatchedOut: TrackEvent | null = null
  let lastDispatchedOutIdx = -1
  let lastDeliveryAssignment: TrackEvent | null = null

  if (shouldComputeWarehouseFacts) {
    firstRealScan = findFirstRealScan(activeEvents, activeProfile)
    if (firstRealScan) {
      firstRealScanBasisLabel = '当前责任段第一次真实操作员扫描'
    } else {
      firstRealScan = findInboundSameCityRealScan(segments, activeSegment)
      if (firstRealScan) {
        firstRealScanBasisLabel = '当前责任段上游同城仓真实操作员扫描（内部转发入库依据）'
      }
    }

    for (let i = activeEvents.length - 1; i >= 0; i -= 1) {
      const event = activeEvents[i]
      if (!lastDeliveryAssignment && event.content.includes('派送任务已分配给派件员')) {
        lastDeliveryAssignment = event
      }
      if (!lastDispatchedOut && isDispatchOutEvent(event)) {
        lastDispatchedOut = event
        lastDispatchedOutIdx = i
      }
      if (lastDeliveryAssignment && lastDispatchedOut) break
    }
  }

  let lastDispatchHasReturn = false
  if (lastDispatchedOutIdx >= 0) {
    for (let i = lastDispatchedOutIdx + 1; i < activeEvents.length; i += 1) {
      if (isReturnOrInventoryEvent(activeEvents[i])) {
        lastDispatchHasReturn = true
        break
      }
    }
  }

  const deliveryAssignmentCount = shouldComputeWarehouseFacts
    ? countEvents(activeEvents, (event) => event.content.includes('派送任务已分配给派件员'))
    : 0
  const deliveryCancelCount = shouldComputeWarehouseFacts
    ? countEvents(activeEvents, (event) => event.content.includes('取消分配') || event.content.includes('撤销分配'))
    : 0
  const problemCount = shouldComputeWarehouseFacts
    ? countEvents(activeEvents, isProblemEvent)
    : 0
  const hasDeliveryCancellations = deliveryCancelCount > 0
  const lastInventory = shouldComputeWarehouseFacts
    ? findLastEvent(activeEvents, (event) => event.content.includes('已盘点'))
    : null
  const maxConsecutiveAssignCancelPairs = shouldComputeWarehouseFacts
    ? countMaxConsecutiveAssignCancelPairs(activeEvents, activeProfile)
    : 0
  const hasAssignCancelLoop = maxConsecutiveAssignCancelPairs >= 2
  const activeTrackResponsibilityPoints = shouldComputeWarehouseFacts
    ? activeEvents
        .map((event) => getTrackResponsibilityPoint(event, activeProfile))
        .filter((point): point is ResponsibilityPoint => point !== null)
    : []
  if (shouldComputeWarehouseFacts && firstRealScan && !activeEvents.includes(firstRealScan)) {
    activeTrackResponsibilityPoints.push({
      owner: 'in_warehouse',
      time: firstRealScan.time,
      basis: `${firstRealScanBasisLabel ?? '当前责任段上游真实操作员扫描'}（${firstRealScan.time}）`,
      source: 'track',
    })
  }
  const interceptResponsibilityPoints = shouldComputeWarehouseFacts
    ? interceptLogs
        .map((log) => getInterceptResponsibilityPoint(log, activeSegment))
        .filter((point): point is ResponsibilityPoint => point !== null)
    : []
  const allResponsibilityPoints = [...activeTrackResponsibilityPoints, ...interceptResponsibilityPoints]
  // 阻断日志当前仓库扫描员是合法的库内真实操作；据此让 hasRealOperatorScan 与责任点时间线保持一致。
  const hasInterceptInWarehouseScan = interceptResponsibilityPoints.some((point) => point.owner === 'in_warehouse')
  const hasRealOperatorScan = firstRealScan !== null || hasInterceptInWarehouseScan
  const latestTrackResponsibilityPoint = findLastResponsibilityPoint(activeTrackResponsibilityPoints)
  const latestInterceptResponsibilityPoint = findLastResponsibilityPoint(interceptResponsibilityPoints)
  const finalResponsibilityPoint = findLastResponsibilityPoint(allResponsibilityPoints)
  const inWarehouseResponsibilityPoint = findLastResponsibilityPointByOwner(allResponsibilityPoints, 'in_warehouse')
  const outWarehouseResponsibilityPoint = findLastResponsibilityPointByOwner(allResponsibilityPoints, 'out_warehouse')
  const inWarehouseStartTime = inWarehouseResponsibilityPoint?.time ?? null
  const inWarehouseBasis = inWarehouseResponsibilityPoint?.basis ?? null
  const inWarehouseStartSupersededByDispatch =
    inWarehouseStartTime !== null &&
    outWarehouseResponsibilityPoint !== null &&
    outWarehouseResponsibilityPoint.time > inWarehouseStartTime
  // 「无出库」只看最后一次库内责任重置点（回站/盘点等）之后的区间：该点之前的出库属于上一轮且已闭环
  // （见 lastDispatchHasReturn），不能用来否定这一轮的分配-取消循环。真实案例 3781059456380：
  // 07-29 出库 → 07-30 回站+盘点 → 此后 3 组分配-取消，旧的「当前责任段全程无出库」口径把它误判成「扫描员丢失」。
  const dispatchAfterInWarehouseStart =
    lastDispatchedOut !== null &&
    (inWarehouseStartTime === null || lastDispatchedOut.time > inWarehouseStartTime)
  const assignCancelLoopWithoutDispatch = hasAssignCancelLoop && !dispatchAfterInWarehouseStart
  const firstAssignCancelDriver = shouldComputeWarehouseFacts
    ? findFirstAssignCancelDriverAfterInWarehouseStart(activeEvents, inWarehouseStartTime, activeProfile)
    : null
  const latestAssignmentAfterLastDispatch =
    lastDeliveryAssignment !== null &&
    lastDispatchedOut !== null &&
    lastDeliveryAssignment.time > lastDispatchedOut.time

  let stationLossCompletion = false
  let merchantDestroyEvent: TrackEvent | null = null
  let merchantDestroyEvidence: string | null = null
  let merchantStorageEvent: TrackEvent | null = null
  let merchantStorageEvidence: string | null = null
  let merchantReturnEvent: TrackEvent | null = null
  let merchantReturnClosedEvidence: string | null = null
  let merchantReturnRequestEvent: TrackEvent | null = null
  let merchantReturnRequestEvidence: string | null = null
  let merchantReturnDirectionRequestEvent: TrackEvent | null = null
  let merchantOtherReturnRequestEvent: TrackEvent | null = null
  let merchantReturnLatestProgressEvent: TrackEvent | null = null
  let merchantReturnLatestProgressEvidence: string | null = null
  let merchantAbandonFeedbackEvent: TrackEvent | null = null
  let merchantAbandonFeedbackEvidence: string | null = null
  let merchantAbandonClosedEvent: TrackEvent | null = null
  let merchantAbandonClosedEvidence: string | null = null
  let deliveryCompletionEvent: TrackEvent | null = null
  let deliveryCompletionEvidence: string | null = null
  let hasDeliveryCompletion = false
  for (const event of sorted) {
    if (event.content.includes('订单异常完结') && STATION_LOSS_RE.test(event.content)) stationLossCompletion = true
    if (isDeliveryCompletionEvent(event)) {
      hasDeliveryCompletion = true
      deliveryCompletionEvent = event
      const stageText = (event.trackStageTx ?? '').trim()
      deliveryCompletionEvidence = extractShortEvidence(
        stageText ? `${stageText} | ${event.content}` : event.content
      )
    }
    if (isMerchantDestroyTerminalEvent(event.content)) {
      merchantDestroyEvent = event
      merchantDestroyEvidence = extractMerchantDestroyEvidence(event.content)
    }
    if (isMerchantStorageEvent(event.content)) {
      merchantStorageEvent = event
      merchantStorageEvidence = extractMerchantStorageEvidence(event.content)
    }
    if (isMerchantReturnEvent(event.content)) {
      merchantReturnEvent = event
      merchantReturnClosedEvidence = extractMerchantReturnEvidence(event.content)
    }
    if (isMerchantReturnRequestEvent(event.content)) {
      merchantReturnRequestEvent = event
      merchantReturnRequestEvidence = extractShortEvidence(event.content)
      if (isMerchantReturnDirectionRequestEvent(event.content)) {
        merchantReturnDirectionRequestEvent = event
      } else {
        merchantOtherReturnRequestEvent = event
      }
    }
    if (
      merchantReturnRequestEvent &&
      event.time >= merchantReturnRequestEvent.time &&
      isMerchantReturnProgressEvent(event.content)
    ) {
      merchantReturnLatestProgressEvent = event
      merchantReturnLatestProgressEvidence = extractShortEvidence(event.content)
    }
    if (isMerchantAbandonFeedbackEvent(event.content)) {
      merchantAbandonFeedbackEvent = event
      merchantAbandonFeedbackEvidence = extractShortEvidence(event.content)
    }
    if (isMerchantAbandonClosedEvent(event.content)) {
      merchantAbandonClosedEvent = event
      merchantAbandonClosedEvidence = extractShortEvidence(event.content)
    }
  }

  const storageScheduleEvent =
    merchantStorageEvent === null
      ? null
      : (sorted.find((event) => event.time > merchantStorageEvent.time && isDeliveryScheduleEvent(event)) ?? null)
  const storageBusinessProgressEvent =
    merchantStorageEvent === null
      ? null
      : (sorted.findLast((event) => event.time > merchantStorageEvent.time && isPostStorageBusinessProgressEvent(event)) ??
        null)
  const merchantStorageReleasedBySchedule = storageScheduleEvent !== null
  const merchantStorageSupersededByBusinessProgress = storageBusinessProgressEvent !== null
  const latestAbandonEvent = merchantAbandonClosedEvent ?? merchantAbandonFeedbackEvent
  const latestMerchantDirection = [
    merchantDestroyEvent ? { type: 'destroy' as const, event: merchantDestroyEvent } : null,
    latestAbandonEvent ? { type: 'abandon' as const, event: latestAbandonEvent } : null,
    merchantStorageEvent ? { type: 'storage' as const, event: merchantStorageEvent } : null,
    merchantReturnEvent ? { type: 'return_closed' as const, event: merchantReturnEvent } : null,
    merchantReturnDirectionRequestEvent ? { type: 'return_direction' as const, event: merchantReturnDirectionRequestEvent } : null,
    merchantOtherReturnRequestEvent ? { type: 'other_return' as const, event: merchantOtherReturnRequestEvent } : null,
  ]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.event.time.localeCompare(b.event.time))
    .at(-1)

  const merchantDestroyActive = latestMerchantDirection?.type === 'destroy'
  const merchantAbandonActive = latestMerchantDirection?.type === 'abandon'
  const merchantStorageActive =
    latestMerchantDirection?.type === 'storage' &&
    !merchantStorageReleasedBySchedule &&
    !merchantStorageSupersededByBusinessProgress
  const merchantReturnClosed = latestMerchantDirection?.type === 'return_closed'
  const merchantReturnDirectionActive = merchantReturnClosed || latestMerchantDirection?.type === 'return_direction'
  const merchantReturnActive = merchantReturnDirectionActive || latestMerchantDirection?.type === 'other_return'

  // 计算：方向指令后是否有真实物理活动支撑（责任点为证据）
  // merchantReturnClosed / merchantAbandonClosed 本身即物理闭环证据，无需后续检查
  const latestActiveDirectionTime: string | null = merchantReturnClosed
    ? null
    : latestMerchantDirection?.event.time ?? null
  const hasPhysicalActivityAfterDirectionFeedback: boolean = merchantReturnClosed
    ? true
    : merchantAbandonActive && merchantAbandonClosedEvent !== null
    ? true
    : latestActiveDirectionTime === null
    ? false
    : allResponsibilityPoints.some((rp) => rp.time > latestActiveDirectionTime)

  const latestInterceptTime = latestIntercept?.gmtIntercept ?? null

  const normalResponsibilityOwner: LossResponsibilityOwner | null = latestTrackResponsibilityPoint?.owner ?? null
  const normalResponsibilityStartTime = latestTrackResponsibilityPoint?.time ?? null
  const interceptAdjustedResponsibilityOwner: LossResponsibilityOwner | null =
    latestInterceptResponsibilityPoint &&
    (!latestTrackResponsibilityPoint || latestInterceptResponsibilityPoint.time > latestTrackResponsibilityPoint.time)
      ? latestInterceptResponsibilityPoint.owner
      : null
  const interceptAdjustedResponsibilityBasis =
    interceptAdjustedResponsibilityOwner && latestInterceptResponsibilityPoint
      ? `${latestInterceptResponsibilityPoint.basis}，晚于正常轨迹最新${normalResponsibilityOwner ? responsibilityOwnerLabel(normalResponsibilityOwner) : '库内/库外'}责任点 ${normalResponsibilityStartTime ?? '-'}，最终责任更新为${responsibilityOwnerLabel(interceptAdjustedResponsibilityOwner)}`
      : null
  const finalResponsibilityBasis = finalResponsibilityPoint
    ? `${finalResponsibilityPoint.basis}，当前责任段最终责任为${responsibilityOwnerLabel(finalResponsibilityPoint.owner)}`
    : null
  const activeSegmentStartTime = activeSegment?.startTime ?? null
  const activeWarehouseLossTimeoutDays = getWarehouseLossTimeoutDays(activeProfile)
  const externalCarrierTransferTime =
    activeSegment?.owner === 'external_carrier' ? activeSegment.startTime : null
  const merchantReturnLatestProgressDestination = merchantReturnLatestProgressEvent
    ? extractTransferDestination(merchantReturnLatestProgressEvent.content)
    : ''
  const merchantReturnDestinationReached =
    merchantReturnLatestProgressEvent !== null &&
    merchantReturnRequestEvent !== null &&
    merchantReturnLatestProgressDestination !== '' &&
    activeSegment?.owner === 'company_warehouse' &&
    hasSameHub(activeSegment, merchantReturnLatestProgressDestination) &&
    finalResponsibilityPoint !== null &&
    finalResponsibilityPoint.time > merchantReturnRequestEvent.time

  return {
    todayStr,
    lastEventTime: lastEvent.time,
    lastEventDaysDiff: daysDiff(lastEvent.time),
    responsibilitySegments: segments.map(toPublicSegment),
    activeSegment: activeSegment ? toPublicSegment(activeSegment) : null,
    activeResponsibilityOwner: activeSegment?.owner ?? 'unknown',
    activeSegmentStatus: activeSegment?.status ?? 'unknown',
    activeWarehouseHubId: activeSegment?.hubId ?? null,
    activeWarehouseName: activeSegment?.hubName ?? null,
    activeWarehouseCityId: activeSegment?.cityId ?? null,
    activeWarehouseKnown: activeSegment?.warehouseKnown ?? false,
    activeWarehouseLossTimeoutDays,
    externalCarrierLossTimeoutDays: EXTERNAL_CARRIER_LOSS_TIMEOUT_DAYS,
    activeExternalCarrierName: activeSegment?.carrierName ?? null,
    activeSegmentStartTime,
    activeSegmentDaysDiff: activeSegmentStartTime ? daysDiff(activeSegmentStartTime) : -1,
    unknownWarehouseInActiveSegment:
      activeSegment?.owner === 'company_warehouse' && activeSegment.hubName !== null && !activeSegment.warehouseKnown,
    externalCarrierTransferTime,
    externalCarrierDaysDiff: externalCarrierTransferTime ? daysDiff(externalCarrierTransferTime) : -1,
    inWarehouseStartTime,
    inWarehouseBasis,
    inWarehouseDaysDiff: inWarehouseStartTime ? daysDiff(inWarehouseStartTime) : -1,
    inWarehouseStartSupersededByDispatch,
    hasDeliveryCancellations,
    hasRealOperatorScan,
    hasDeliveryCompletion,
    deliveryCompletionTime: deliveryCompletionEvent?.time ?? null,
    deliveryCompletionEvidence,
    latestOrderExceptionClosed,
    latestOrderExceptionClosedTime: latestOrderExceptionClosed ? lastEvent.time : null,
    latestOrderExceptionClosedEvidence,
    lastDispatchedOutTime: lastDispatchedOut?.time ?? null,
    outWarehouseDaysDiff: outWarehouseResponsibilityPoint ? daysDiff(outWarehouseResponsibilityPoint.time) : -1,
    lastDispatchHasReturn,
    latestAssignmentAfterLastDispatch,
    deliveryAssignmentCount,
    deliveryCancelCount,
    problemCount,
    lastInventoryTime: lastInventory?.time ?? null,
    lastInventoryDaysDiff: lastInventory ? daysDiff(lastInventory.time) : -1,
    assignCancelLoopWithoutDispatch,
    firstAssignCancelDriver,
    stationLossCompletion,
    hasInterceptLogs: interceptLogs.length > 0,
    latestInterceptTime,
    latestInterceptUserCode: latestIntercept?.scanUserCode ?? null,
    latestInterceptUserName: latestIntercept?.scanUserName ?? null,
    latestInterceptOperatorType: latestIntercept?.operatorType ?? null,
    latestInterceptAfterInWarehouseStart: isInterceptAfter(latestInterceptTime, inWarehouseStartTime),
    latestInterceptAfterOutWarehouseStart: isInterceptAfter(latestInterceptTime, outWarehouseResponsibilityPoint?.time ?? null),
    interceptAdjustedResponsibilityOwner,
    interceptAdjustedResponsibilityStartTime: interceptAdjustedResponsibilityOwner
      ? latestInterceptResponsibilityPoint?.time ?? null
      : null,
    interceptAdjustedResponsibilityDaysDiff:
      interceptAdjustedResponsibilityOwner && latestInterceptResponsibilityPoint
        ? daysDiff(latestInterceptResponsibilityPoint.time)
        : -1,
    interceptAdjustedResponsibilityBasis,
    finalResponsibilityOwner: finalResponsibilityPoint?.owner ?? null,
    finalResponsibilityStartTime: finalResponsibilityPoint?.time ?? null,
    finalResponsibilitySource: finalResponsibilityPoint?.source ?? null,
    finalResponsibilityDaysDiff: finalResponsibilityPoint ? daysDiff(finalResponsibilityPoint.time) : -1,
    finalResponsibilityBasis,
    merchantDestroyConfirmed: merchantDestroyActive,
    merchantDestroyConfirmTime: merchantDestroyEvent?.time ?? null,
    merchantDestroyEvidence,
    merchantAbandonActive,
    merchantAbandonConfirmTime: latestAbandonEvent?.time ?? null,
    merchantAbandonEvidence:
      latestAbandonEvent === merchantAbandonClosedEvent ? merchantAbandonClosedEvidence : merchantAbandonFeedbackEvidence,
    merchantAbandonClosed: merchantAbandonClosedEvent !== null,
    merchantAbandonClosedTime: merchantAbandonClosedEvent?.time ?? null,
    merchantAbandonClosedEvidence,
    merchantStorageActive,
    merchantStorageConfirmTime: merchantStorageEvent?.time ?? null,
    merchantStorageEvidence,
    merchantStorageReleasedBySchedule,
    merchantStorageScheduleTime: storageScheduleEvent?.time ?? null,
    merchantStorageSupersededByBusinessProgress,
    merchantStorageBusinessProgressTime: storageBusinessProgressEvent?.time ?? null,
    merchantStorageBusinessProgressEvidence: storageBusinessProgressEvent?.content ?? null,
    hasPhysicalActivityAfterDirectionFeedback,
    merchantReturnClosed,
    merchantReturnClosedTime: merchantReturnClosed ? merchantReturnEvent?.time ?? null : null,
    merchantReturnClosedEvidence: merchantReturnClosed ? merchantReturnClosedEvidence : null,
    merchantReturnDirectionActive,
    merchantReturnRequested: merchantReturnRequestEvent !== null && !merchantReturnClosed && merchantReturnActive,
    merchantReturnRequestTime: merchantReturnRequestEvent?.time ?? null,
    merchantReturnRequestDaysDiff: merchantReturnRequestEvent ? daysDiff(merchantReturnRequestEvent.time) : -1,
    merchantReturnRequestEvidence,
    merchantReturnLatestProgressTime: merchantReturnLatestProgressEvent?.time ?? null,
    merchantReturnLatestProgressDaysDiff: merchantReturnLatestProgressEvent
      ? daysDiff(merchantReturnLatestProgressEvent.time)
      : -1,
    merchantReturnLatestProgressEvidence,
    merchantReturnTransferInProgress:
      merchantReturnRequestEvent !== null &&
      !merchantReturnClosed &&
      merchantReturnLatestProgressEvent !== null &&
      isBoxedTransferEvent(merchantReturnLatestProgressEvent.content) &&
      !merchantReturnDestinationReached &&
      (!finalResponsibilityPoint || finalResponsibilityPoint.time <= merchantReturnLatestProgressEvent.time),
    latestEventKind: summarizeLatestEvent(lastEvent),
  }
}

function formatSegmentSummary(facts: TrackFacts): string {
  if (!facts.responsibilitySegments.length) return '责任段: 无'
  return facts.responsibilitySegments
    .map((segment, index) => {
      const owner =
        segment.owner === 'company_warehouse'
          ? `公司仓库 ${segment.hubName ?? '未知仓库'}${segment.warehouseKnown ? '' : '（未配置）'}`
          : segment.owner === 'external_carrier'
            ? `外部承运商 ${segment.carrierName ?? '未知承运商'}`
            : '未知责任'
      return `${index + 1}. ${segment.startTime} -> ${segment.endTime ?? '当前'} | ${owner} | ${segment.startReason}${segment.endReason ? `；${segment.endReason}` : ''}`
    })
    .join('\n')
}

/**
 * 将 `deriveTrackFacts` 的结构化结果渲染成 LLM prompt 中的时序分析文本。
 * LLM 直接使用这些预计算值，无需自行推算时间差。
 */
export function computeTrackTemporalContext(
  tracks: TrackEvent[],
  interceptLogs: ScanInterceptLog[] = [],
  options: { analysisDate?: string | Date } = {}
): string {
  const facts = deriveTrackFacts(tracks, interceptLogs, options)

  if (!tracks.length) {
    return `[时序分析（服务端预计算，直接使用，禁止自行推算时间差）]\n今天: ${facts.todayStr}\n轨迹为空，无法计算时序特征。`
  }

  const lines: string[] = [
    '[时序分析（服务端预计算，直接使用，禁止自行推算时间差）]',
    `今天: ${facts.todayStr}`,
    `最后更新: ${facts.lastEventTime}（距今 ${facts.lastEventDaysDiff} 天）`,
    `当前最新事件: ${facts.latestEventKind}`,
    '',
    '--- 当前责任段（服务端确定性解析，必须优先使用） ---',
    `当前责任主体: ${facts.activeResponsibilityOwner}`,
    `当前责任状态: ${facts.activeSegmentStatus}`,
    `当前责任段起算: ${facts.activeSegmentStartTime ?? '无法确定'}（距今 ${facts.activeSegmentDaysDiff} 天）`,
  ]

  if (facts.activeResponsibilityOwner === 'company_warehouse') {
    lines.push(
      `当前仓库: ${facts.activeWarehouseName ?? '未知'}${facts.activeWarehouseKnown ? `（${facts.activeWarehouseCityId}/${facts.activeWarehouseHubId}）` : '（未匹配仓库配置）'}`
    )
    lines.push(`当前仓库丢失超时阈值: ${facts.activeWarehouseLossTimeoutDays} 天`)
    if (!facts.activeWarehouseKnown) {
      lines.push('仓库配置状态: 未知仓库，禁止默认把操作员视为真实操作员；若结论依赖真实操作员，应输出「需人工判断」。')
    }
  } else if (facts.activeResponsibilityOwner === 'external_carrier') {
    lines.push(
      `外部承运商: ${facts.activeExternalCarrierName ?? '未知'}；转交时间: ${facts.externalCarrierTransferTime ?? '-'}（距今 ${facts.externalCarrierDaysDiff} 天）`
    )
    lines.push('当前已转交外部承运且未进入公司仓库责任段，禁止继续沿用历史仓库的库内/库外起算。')
    lines.push(
      `外部承运超时规则: 最后更新未满 ${facts.externalCarrierLossTimeoutDays} 天为「暂无异常」；最后更新达到 ${facts.externalCarrierLossTimeoutDays} 天且无正常完结时判定为「3PL丢件」。`
    )
  }

  lines.push('责任段摘要:')
  lines.push(formatSegmentSummary(facts))

  lines.push('')
  lines.push('--- 当前责任段：库内责任超时 ---')
  lines.push(
    `真实操作员扫描记录: ${facts.hasRealOperatorScan ? '是（仓内扫描/盘点，不含「包裹正在派送中」二次出库扫描）' : '否（当前责任段无可确认为真实操作员的仓内扫描/盘点）'}`
  )

  if (facts.inWarehouseStartTime && facts.inWarehouseBasis) {
    lines.push(
      `库内起算时间: ${facts.inWarehouseStartTime}（${facts.inWarehouseBasis}）  距今: ${facts.inWarehouseDaysDiff} 天`
    )
  } else {
    lines.push('库内起算时间: 无法确定（当前责任段无真实操作员扫描/回仓/盘点）')
  }
  if (!facts.inWarehouseStartTime && facts.lastDispatchedOutTime) {
    lines.push(
      `库内起算时间之后已真正出库: 不适用（库内起算无法确定；但当前责任段存在「包裹正在派送中」二次扫描 ${facts.lastDispatchedOutTime}，出库责任按库外字段判断）`
    )
  } else {
    lines.push(
      `库内起算时间之后已真正出库: ${facts.inWarehouseStartSupersededByDispatch ? '是（当前责任段存在「包裹正在派送中」二次扫描，库内责任已转移）' : '否（当前责任段无「包裹正在派送中」，或出库后已回站/盘点）'}`
    )
  }
  lines.push(
    `存在分配→取消分配循环: ${facts.assignCancelLoopWithoutDispatch ? '是' : '否'}（仅统计当前责任段；历史责任段不得混入当前判断）`
  )

  lines.push('')
  lines.push('--- 当前责任段：库外责任超时 ---')
  if (facts.finalResponsibilityOwner === 'out_warehouse' && facts.finalResponsibilityStartTime) {
    lines.push(
      `库外起算时间: ${facts.finalResponsibilityStartTime}（当前责任段最终库外责任点）  距今: ${facts.finalResponsibilityDaysDiff} 天`
    )
    if (facts.lastDispatchedOutTime) {
      lines.push(
        `最近一次正常轨迹出库后已有回站/盘点记录: ${facts.lastDispatchHasReturn ? '是（仅说明该回仓时间点责任曾回到库内；最终责任仍以最后责任点为准）' : '否（当前责任段包裹仍在库外派送中）'}`
      )
    }
  } else if (facts.lastDispatchedOutTime) {
    lines.push(
      `库外起算时间: ${facts.lastDispatchedOutTime}（当前责任段最近一次「包裹正在派送中」二次扫描出库）  距今: ${facts.outWarehouseDaysDiff} 天`
    )
    lines.push(
      `最近一次出库后已有回站/盘点记录: ${facts.lastDispatchHasReturn ? '是（当前责任段包裹已回仓，责任已重置）' : '否（当前责任段包裹仍在库外派送中）'}`
    )
  } else if (facts.deliveryAssignmentCount > 0) {
    lines.push(
      '库外起算时间: 无法确定（当前责任段仅有「派送任务已分配」但无「包裹正在派送中」二次扫描，包裹未真正出库）'
    )
  } else {
    lines.push('库外起算时间: 无法确定（当前责任段无派送分配记录）')
  }

  lines.push('')
  lines.push('--- 其他参考 ---')
  lines.push(
    `当前责任段派送分配次数: ${facts.deliveryAssignmentCount}  取消分配次数: ${facts.deliveryCancelCount}  问题件登记次数: ${facts.problemCount}`
  )
  lines.push(
    `正常完结记录: ${facts.hasDeliveryCompletion ? `是（${facts.deliveryCompletionTime ?? '-'}，${facts.deliveryCompletionEvidence ?? '命中签收/妥投/派件完成关键词'}）` : '否'}`
  )
  if (facts.latestOrderExceptionClosed) {
    lines.push(
      `订单异常完结终态: 是（${facts.latestOrderExceptionClosedTime ?? '-'}，证据: ${facts.latestOrderExceptionClosedEvidence ?? '命中订单异常完结'}）  → 最新轨迹已显示订单异常闭环，优先判定「暂无异常」，子类型建议「订单已完结」`
    )
  }
  if (facts.lastInventoryTime) {
    lines.push(`当前责任段最近盘点: ${facts.lastInventoryTime}（距今 ${facts.lastInventoryDaysDiff} 天）`)
  }

  if (facts.assignCancelLoopWithoutDispatch) {
    if (facts.hasRealOperatorScan) {
      lines.push(
        '分配-取消循环（库内起算之后无成功出库）: 是，且当前责任段存在真实操作员扫描入库  → 派件员反复领取后退回、包裹自最近一次回仓/盘点起始终在当前仓库未离开。⚠️ 该信号本身不构成丢失判定，是否判库内丢失仍必须以「最终责任点距今天数 ≥ 当前仓库丢失超时阈值」为准；仅在已超阈值时用于将子类型定为「疑似派件员窃取」'
      )
    } else {
      lines.push(
        '分配-取消循环（库内起算之后无成功出库）: 是，但当前责任段无真实操作员扫描入库（真实操作员扫描记录: 否）  → 责任尚未真正进入库内、包裹也未真正出库，是「虚假转运」的典型特征，禁止据此判库内丢失'
      )
    }
  } else {
    const dispatchedAfterInWarehouseStart =
      facts.lastDispatchedOutTime !== null &&
      (facts.inWarehouseStartTime === null || facts.lastDispatchedOutTime > facts.inWarehouseStartTime)
    const noLoopReason = dispatchedAfterInWarehouseStart
      ? `库内起算之后存在「包裹正在派送中」真实出库（${facts.lastDispatchedOutTime}），不构成"库内起算后无成功出库循环"`
      : '当前责任段连续分配-取消配对未达到阈值，或当前不在公司仓库责任段'
    lines.push(`分配-取消循环（库内起算之后无成功出库）: 否  → ${noLoopReason}`)
  }

  if (facts.stationLossCompletion) {
    lines.push(
      '承运商完结标记: 站内丢包(station_loss)  → 仅作辅助证据，必须先按当前责任段事实判断 lossScope'
    )
  }
  if (facts.hasInterceptLogs) {
    if (facts.latestInterceptTime && facts.latestInterceptUserCode && facts.latestInterceptOperatorType) {
      lines.push(
        `阻断日志责任点: 最新阻断时间 ${facts.latestInterceptTime}，scanUserCode=${facts.latestInterceptUserCode}，scanUserName=${facts.latestInterceptUserName ?? '-'}（${interceptOperatorLabel(facts.latestInterceptOperatorType)}）；晚于库内起算: ${facts.latestInterceptAfterInWarehouseStart ? '是' : '否'}；晚于库外起算: ${facts.latestInterceptAfterOutWarehouseStart ? '是' : '否'}。服务端已将该责任点按时间并入当前公司仓库责任段。`
      )
      if (facts.interceptAdjustedResponsibilityOwner && facts.interceptAdjustedResponsibilityStartTime) {
        lines.push(
          `阻断日志更新后的最终责任: ${responsibilityOwnerLabel(facts.interceptAdjustedResponsibilityOwner)}；最终起算时间: ${facts.interceptAdjustedResponsibilityStartTime}（距今 ${facts.interceptAdjustedResponsibilityDaysDiff} 天）。必须基于该最终起算时间重新判断是否达到当前仓库 ${facts.activeWarehouseLossTimeoutDays} 天阈值。`
        )
      }
    } else {
      lines.push('阻断日志辅助判断: 存在阻断日志，但无可解析的 gmtIntercept，不参与库内/库外责任反转。')
    }
  }
  if (facts.finalResponsibilityOwner && facts.finalResponsibilityStartTime) {
    lines.push(
      `当前责任段最终责任点: ${responsibilityOwnerLabel(facts.finalResponsibilityOwner)}；时间: ${facts.finalResponsibilityStartTime}（距今 ${facts.finalResponsibilityDaysDiff} 天）；依据: ${facts.finalResponsibilityBasis ?? '-'}。库内/库外丢失必须以该最终责任点为准。`
    )
  }
  if (facts.merchantAbandonActive) {
    const closedNote = facts.merchantAbandonClosed
      ? `；已闭环「退件已销毁」: ${facts.merchantAbandonClosedTime ?? '-'}，${facts.merchantAbandonClosedEvidence ?? '命中退件已销毁'}`
      : ''
    lines.push(
      `商家Abandon销毁: 是（${facts.merchantAbandonConfirmTime ?? '-'}，证据: ${facts.merchantAbandonEvidence ?? '命中Abandon关键词'}${closedNote}）  → 商家已确认Abandon销毁且为当前最新反馈，优先判定「暂无异常」，子类型建议「Abandon销毁」`
    )
  }
  if (facts.merchantDestroyConfirmed) {
    lines.push(
      `商家销毁终态: 是（${facts.merchantDestroyConfirmTime ?? '-'}，证据: ${facts.merchantDestroyEvidence ?? '命中销毁关键词'}）  → 该订单已进入商家确认销毁闭环，优先判定「暂无异常」，子类型建议「Abandon销毁」`
    )
  }
  if (facts.merchantReturnClosed) {
    lines.push(
      `退返商家闭环: 是（${facts.merchantReturnClosedTime ?? '-'}，证据: ${facts.merchantReturnClosedEvidence ?? '命中退返闭环关键词'}）  → 该订单已完成退返/退回商家，优先判定「暂无异常」，子类型建议「退返商家」`
    )
  } else if (facts.merchantReturnRequested) {
    lines.push(
      `退返商家待处理: 是（${facts.merchantReturnRequestTime ?? '-'}，证据: ${facts.merchantReturnRequestEvidence ?? '命中退返处理方向'}；最新推进: ${facts.merchantReturnLatestProgressTime ?? '-'}，${facts.merchantReturnLatestProgressEvidence ?? '无'}）  → 商家已给出退返方向但未出现退返闭环；该方向不改变责任点，最终结论仍以当前责任段最终责任点和当前仓库阈值为准；仅在 lossScope 为「暂无异常」时使用子类型「退返商家」`
    )
  }
  if (facts.merchantStorageActive) {
      lines.push(
      `商家暂存终态: 是（${facts.merchantStorageConfirmTime ?? '-'}，证据: ${facts.merchantStorageEvidence ?? '命中暂存关键词'}）  → 暂存无库内/库外超时逻辑，优先判定「暂无异常」，子类型建议「暂存」`
    )
  } else if (facts.merchantStorageReleasedBySchedule) {
    lines.push(
      `商家暂存终态: 否（${facts.merchantStorageConfirmTime ?? '-'} 后于 ${facts.merchantStorageScheduleTime ?? '-'} 出现预约派送）  → 暂存状态已释放，恢复当前责任段库内/库外 ${facts.activeWarehouseLossTimeoutDays} 天时效判断`
    )
  } else if (facts.merchantStorageSupersededByBusinessProgress) {
    lines.push(
      `商家暂存终态: 否（${facts.merchantStorageConfirmTime ?? '-'} 后于 ${facts.merchantStorageBusinessProgressTime ?? '-'} 出现新的业务推进）  → 以最新轨迹为准，不再使用「暂存」子类型；证据: ${facts.merchantStorageBusinessProgressEvidence ?? '命中后续业务轨迹'}`
    )
  }

  return lines.join('\n')
}
