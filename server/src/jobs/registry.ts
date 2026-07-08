import type { JobHandler } from './types'

const handlers = new Map<string, JobHandler>()

export function registerJobHandler(handler: JobHandler): void {
  handlers.set(handler.type, handler)
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type)
}

export function listRegisteredJobTypes(): string[] {
  return Array.from(handlers.keys()).sort()
}
