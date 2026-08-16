import type {
  LatestResponsibility,
  OrderAnalyzeExtraData,
  OrderAnalyzeInterceptLog,
  OrderAnalyzeResponsibilityOwner,
  OrderQueryInfo,
} from './orderExceptionApi'
import type { TrackEvent } from './types'

export type AnalysisRowStatus = 'pending' | 'analyzing' | 'done' | 'error'

export type AnalysisRow = {
  orderNo: string
  lossScope: string
  categoryName: string
  currentResponsibilityParty: string
  activeResponsibilityOwner?: OrderAnalyzeResponsibilityOwner
  reason: string
  confidence: string
  trackEvents: TrackEvent[]
  interceptLogs: OrderAnalyzeInterceptLog[]
  /** 最新责任点：责任人/操作/时间/无操作天数，服务端解析好的统一字段 */
  latestResponsibility?: LatestResponsibility | null
  detectedDriverId?: string
  needsReview?: boolean
  crossCheckedBy?: string | null
  status?: AnalysisRowStatus
  orderInfo?: OrderQueryInfo | null
  /** 与判定无关的补充信息，服务端富化阶段填充；缺失表示该单无额外数据 */
  extraData?: OrderAnalyzeExtraData
}

export type AnalyzeProgress = {
  total: number
  completed: number
  succeeded: number
  failed: number
}

export type ImportedAnalyzeOrders = {
  fileName: string
  orderNos: string[]
}

export type SubmittedJobBanner = {
  jobId: string
  orderCount: number
}
