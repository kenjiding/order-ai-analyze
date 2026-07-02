import { registerJobHandler } from '../registry'
import { systemNoopHandler } from './systemNoop'
import { orderAnalyzeHandler } from './orderAnalyzeHandler'
import { vendorAnalyzeHandler } from './vendorAnalyzeHandler'

export function registerBuiltInJobHandlers(): void {
  registerJobHandler(systemNoopHandler)
  registerJobHandler(orderAnalyzeHandler)
  registerJobHandler(vendorAnalyzeHandler)
}

export { SYSTEM_NOOP_JOB_TYPE } from './systemNoop'
export { ORDER_ANALYZE_JOB_TYPE } from './orderAnalyzeHandler'
export { VENDOR_ANALYZE_JOB_TYPE } from './vendorAnalyzeHandler'
