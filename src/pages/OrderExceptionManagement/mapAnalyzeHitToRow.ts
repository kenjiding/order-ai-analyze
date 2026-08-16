import type {
  LatestResponsibility,
  OrderAnalyzeInterceptLog,
  OrderAnalyzeResultItem,
  OrderQueryInfo,
} from './orderExceptionApi'
import type { TrackEvent } from './types'
import type { AnalysisRow } from './analysisTypes'

const TRACK_DRIVER_ID_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)/i

export function createPendingAnalysisRow(orderNo: string): AnalysisRow {
  return {
    orderNo,
    lossScope: '—',
    categoryName: '—',
    currentResponsibilityParty: '—',
    reason: '待分析',
    confidence: '—',
    trackEvents: [],
    interceptLogs: [],
    detectedDriverId: '',
    status: 'pending',
  }
}

function extractDriverIdFromTrackContent(content: string): string {
  const match = TRACK_DRIVER_ID_RE.exec(content)
  return match?.[1]?.trim() ?? ''
}

function deriveDetectedDriverId(
  latestResponsibility: LatestResponsibility | null | undefined,
  trackEvents: TrackEvent[],
  interceptLogs: OrderAnalyzeInterceptLog[],
): string {
  if (latestResponsibility?.source === 'track') {
    const matchedTrack = trackEvents.find((event) => event.time === latestResponsibility.time)
    const fromTrack = matchedTrack ? extractDriverIdFromTrackContent(matchedTrack.content) : ''
    if (fromTrack) return fromTrack
  }

  if (latestResponsibility?.source === 'intercept') {
    const matchedIntercept = interceptLogs.find((log) => log.gmtIntercept === latestResponsibility.time)
    const fromIntercept = matchedIntercept?.scanUserCode.trim() ?? ''
    if (fromIntercept) return fromIntercept
  }

  const latestTrackDriverId = [...trackEvents]
    .sort((a, b) => b.time.localeCompare(a.time))
    .map((event) => extractDriverIdFromTrackContent(event.content))
    .find(Boolean)
  if (latestTrackDriverId) return latestTrackDriverId

  const latestInterceptDriverId = [...interceptLogs]
    .sort((a, b) => b.gmtIntercept.localeCompare(a.gmtIntercept))
    .map((log) => log.scanUserCode.trim())
    .find(Boolean)
  return latestInterceptDriverId ?? ''
}

export function mapAnalyzeHitToRow(
  orderNo: string,
  hit: OrderAnalyzeResultItem | undefined,
  trackInfo: Record<string, TrackEvent[]>,
  interceptLogsByOrder: Record<string, OrderAnalyzeInterceptLog[]>,
  orderInfoByOrder: Record<string, OrderQueryInfo | null>,
): AnalysisRow {
  const trackEvents = trackInfo[orderNo] ?? []
  const interceptLogs = interceptLogsByOrder[orderNo] ?? []
  const orderInfo = orderInfoByOrder[orderNo] ?? null
  if (!hit) {
    const hasTrack = trackEvents.length > 0
    return {
      orderNo,
      lossScope: '—',
      categoryName: '—',
      currentResponsibilityParty: '—',
      reason: hasTrack ? '模型未返回该单行，请重试或缩小批量' : '无轨迹数据',
      confidence: '—',
      trackEvents,
      interceptLogs,
      orderInfo,
      status: 'done',
    }
  }
  return {
    orderNo: hit.orderNo,
    lossScope: hit.lossScope,
    categoryName: hit.exceptionCategoryId || '—',
    currentResponsibilityParty: hit.currentResponsibilityParty || '—',
    activeResponsibilityOwner: hit.activeResponsibilityOwner,
    reason: hit.reason,
    confidence: Number.isFinite(hit.confidence) ? hit.confidence.toFixed(2) : String(hit.confidence),
    trackEvents,
    interceptLogs,
    orderInfo,
    latestResponsibility: hit.latestResponsibility ?? null,
    detectedDriverId: deriveDetectedDriverId(hit.latestResponsibility, trackEvents, interceptLogs),
    needsReview: hit.needsReview ?? false,
    crossCheckedBy: hit.crossCheckedBy ?? null,
    extraData: hit.extraData,
    status: 'done',
  }
}
