import { registerJobHandler } from '../registry'
import { systemNoopHandler } from './systemNoop'

export function registerBuiltInJobHandlers(): void {
  registerJobHandler(systemNoopHandler)
}

export { SYSTEM_NOOP_JOB_TYPE } from './systemNoop'
