import { mergeBatchRaw, sleep } from './shared'
import { requestImileApi, type ImileClientError } from './client'
import { readResultPagination, readResultRows } from './resultObject'

export type PaginatedResultsSuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  raw: unknown
}

export type PaginatedResultsError = ImileClientError

/**
 * 拉取 resultObject.results 分页列表（totalPage 不可信，按 totalResult/showCount 计算页数）。
 */
export async function fetchPaginatedResultRows(options: {
  label: string
  requestPage: (body: Record<string, unknown>) => ReturnType<typeof requestImileApi>
  buildPageBody: (input: { currentPage: number; showCount: number }) => Record<string, unknown>
  pageShowCount: number
  pageDelayMs?: number
}): Promise<PaginatedResultsSuccess | PaginatedResultsError> {
  const pageDelayMs = options.pageDelayMs ?? 400

  const probe = await options.requestPage(options.buildPageBody({ currentPage: 1, showCount: 1 }))
  if (!probe.ok) return probe

  const { totalResult } = readResultPagination(probe.json)
  if (totalResult <= 0) {
    return {
      ok: true,
      records: readResultRows(probe.json),
      totalResult: 0,
      raw: probe.json,
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalResult / options.pageShowCount))
  const records: unknown[] = []
  const raws: unknown[] = []

  for (let page = 1; page <= totalPages; page += 1) {
    const res = await options.requestPage(
      options.buildPageBody({ currentPage: page, showCount: options.pageShowCount }),
    )
    if (!res.ok) return res

    raws.push(res.json)
    records.push(...readResultRows(res.json))

    if (page < totalPages) await sleep(pageDelayMs)
  }

  return {
    ok: true,
    records,
    totalResult,
    raw: mergeBatchRaw(raws),
  }
}
