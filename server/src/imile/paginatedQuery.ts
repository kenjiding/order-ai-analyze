import { mergeBatchRaw, sleep } from './shared'
import { requestImileApi, type ImileClientError } from './client'
import { readResultPagination, readResultRows } from './resultObject'
import { mapWithConcurrency } from '../orderAnalyze/runtime'

export type PaginatedResultsSuccess = {
  ok: true
  records: unknown[]
  totalResult: number
  raw: unknown
}

export type PaginatedResultsError = ImileClientError

/**
 * 拉取 resultObject.results 分页列表（totalPage 不可信，按 totalResult/showCount 计算页数）。
 * concurrency > 1 时并发拉取所有页，去掉页间延迟；默认 1（顺序，保持向后兼容）。
 */
export async function fetchPaginatedResultRows(options: {
  label: string
  requestPage: (body: Record<string, unknown>) => ReturnType<typeof requestImileApi>
  buildPageBody: (input: { currentPage: number; showCount: number }) => Record<string, unknown>
  pageShowCount: number
  pageDelayMs?: number
  concurrency?: number
}): Promise<PaginatedResultsSuccess | PaginatedResultsError> {
  const concurrency = options.concurrency ?? 1
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
  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)

  if (concurrency > 1) {
    const pageResults = await mapWithConcurrency(
      pageNums,
      concurrency,
      async (page) => {
        const res = await options.requestPage(
          options.buildPageBody({ currentPage: page, showCount: options.pageShowCount }),
        )
        // 每页请求后等待，控制整体打出速率避免触发限流
        await sleep(pageDelayMs)
        return res
      },
    )

    const records: unknown[] = []
    const raws: unknown[] = []
    for (const res of pageResults) {
      if (!res.ok) return res
      raws.push(res.json)
      records.push(...readResultRows(res.json))
    }
    return { ok: true, records, totalResult, raw: mergeBatchRaw(raws) }
  }

  const records: unknown[] = []
  const raws: unknown[] = []

  for (const page of pageNums) {
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
