import { registerJobHandler } from '../registry'
import { systemNoopHandler } from './systemNoop'
import { orderAnalyzeHandler } from './orderAnalyzeHandler'
import { vendorAnalyzeHandler } from './vendorAnalyzeHandler'
import { dispatchPerformanceSettleHandler } from './dispatchPerformanceSettleHandler'
import { dispatchPerformanceUploadSettleHandler } from './dispatchPerformanceUploadSettleHandler'

export function registerBuiltInJobHandlers(): void {
  registerJobHandler(systemNoopHandler)
  registerJobHandler(orderAnalyzeHandler)
  registerJobHandler(vendorAnalyzeHandler)
  registerJobHandler(dispatchPerformanceSettleHandler)
  registerJobHandler(dispatchPerformanceUploadSettleHandler)
}

export { SYSTEM_NOOP_JOB_TYPE } from './systemNoop'
export { ORDER_ANALYZE_JOB_TYPE } from './orderAnalyzeHandler'
export { VENDOR_ANALYZE_JOB_TYPE } from './vendorAnalyzeHandler'
export { DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE } from './dispatchPerformanceSettleHandler'
export { DISPATCH_PERFORMANCE_UPLOAD_SETTLE_JOB_TYPE } from './dispatchPerformanceUploadSettleHandler'
