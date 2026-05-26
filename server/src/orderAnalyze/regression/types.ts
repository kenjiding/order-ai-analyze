import type { ScanInterceptLog } from '../../imile/interceptLogs'
import type { TrackEvent } from '../../imile/track'
import type { AiLossScope } from '../types'
import type { OrderAnalyzeAiProvider } from '../pipeline'

export type RegressionExpected = {
  lossScope: AiLossScope
  exceptionCategoryId: string
  reason: string
}

export type OrderAnalyzeRegressionFixture = {
  id: string
  orderNo: string
  capturedAt: string
  expected: RegressionExpected
  tracks: TrackEvent[]
  interceptLogs: ScanInterceptLog[]
  meta?: {
    aiProvider?: OrderAnalyzeAiProvider
    note?: string
  }
}

export type RegressionCaseListItem = {
  id: string
  orderNo: string
  capturedAt: string
  expected: RegressionExpected
  trackCount: number
  interceptLogCount: number
}

export type RegressionMismatchField = 'lossScope' | 'exceptionCategoryId'

export type RegressionCaseResult = {
  id: string
  orderNo: string
  pass: boolean
  mismatches: RegressionMismatchField[]
  expected: RegressionExpected
  actual: {
    lossScope: string
    exceptionCategoryId: string
    currentResponsibilityParty?: string
    reason: string
    confidence: number
    needsReview?: boolean
    crossCheckedBy?: 'openai' | 'deepseek' | null
  }
}

export type RegressionRunReport = {
  summary: { total: number; passed: number; failed: number }
  cases: RegressionCaseResult[]
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    apiCalls: number
  }
}
