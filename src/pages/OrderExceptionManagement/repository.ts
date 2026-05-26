import { createIndexedDbOrderExceptionRepository } from './repository.idb'
import type { OrderExceptionRepository } from './repository.contract'

export type { OrderExceptionRepository } from './repository.contract'

let repo: OrderExceptionRepository | null = null

export function getOrderExceptionRepository(): OrderExceptionRepository | null {
  if (typeof indexedDB === 'undefined') return null
  if (!repo) {
    repo = createIndexedDbOrderExceptionRepository()
  }
  return repo
}
