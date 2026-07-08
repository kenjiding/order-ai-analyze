import { isRecord } from './shared'

export function readResultObject(payload: unknown): unknown {
  if (!isRecord(payload)) return null
  return payload.resultObject
}

export type ImilePagination = {
  totalResult: number
  showCount: number
  currentPage: number
}

export function readResultPagination(payload: unknown): ImilePagination {
  if (!isRecord(payload)) return { totalResult: 0, showCount: 0, currentPage: 0 }
  const ro = payload.resultObject
  if (!isRecord(ro) || !isRecord(ro.pagination)) {
    return { totalResult: 0, showCount: 0, currentPage: 0 }
  }
  return {
    totalResult: Number(ro.pagination.totalResult ?? 0),
    showCount: Number(ro.pagination.showCount ?? 0),
    currentPage: Number(ro.pagination.currentPage ?? 0),
  }
}

/** resultObject.results */
export function readResultRows(payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  const ro = payload.resultObject
  if (!isRecord(ro) || !Array.isArray(ro.results)) return []
  return ro.results
}

/** resultObject 为数组，或 results / list / data 列表 */
export function readResultListRows(payload: unknown): unknown[] {
  const resultObject = readResultObject(payload)
  if (Array.isArray(resultObject)) return resultObject
  if (!isRecord(resultObject)) return []
  if (Array.isArray(resultObject.results)) return resultObject.results
  if (Array.isArray(resultObject.list)) return resultObject.list
  if (Array.isArray(resultObject.data)) return resultObject.data
  return []
}
