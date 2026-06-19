import { registerJobHandler } from '../registry'
import { systemNoopHandler } from './systemNoop'
import { orderAnalyzeHandler } from './orderAnalyzeHandler'

export function registerBuiltInJobHandlers(): void {
  registerJobHandler(systemNoopHandler)
  registerJobHandler(orderAnalyzeHandler)
}

export { SYSTEM_NOOP_JOB_TYPE } from './systemNoop'
export { ORDER_ANALYZE_JOB_TYPE } from './orderAnalyzeHandler'
