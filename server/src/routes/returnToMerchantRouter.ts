import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { readImileTokenFromRequest } from './imileAuth'
import { submitReturnToMerchant } from '../imile/returnToMerchant'
import { Semaphore } from '../imile/semaphore'
import { fetchBagInfo } from '../imile/bagInfo'

export const returnToMerchantRouter = Router()

/** 单次批量上限：移动端一次扫这么多已经够用，超出直接拒绝而不是静默截断 */
const MAX_ITEMS = 200
/** 商家码格式：移动端来自固定下拉，「退返商家完结」页来自 iMile 集包的 targetCode，只做格式校验 */
const CLIENT_CODE_RE = /^C\d{6,}$/
/** 逐单调用 iMile，限制并发避免触发上游限流 */
const SUBMIT_CONCURRENCY = 3

type SubmitItemInput = {
  id: string
  scanNumber: string
  clientCode: string
}

export type ReturnToMerchantItemResult = {
  id: string
  scanNumber: string
  clientCode: string
  ok: boolean
  /** iMile resultObject.blockCode，非 0 表示被拦截；成功时该字段缺失 */
  blockCode?: number | null
  blockInfo?: string
  operateTypeDesc?: string
  error?: string
}

function parseItems(raw: unknown): { items: SubmitItemInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: '缺少必填字段: items' }
  }
  if (raw.length > MAX_ITEMS) {
    return { error: `单次最多提交 ${MAX_ITEMS} 组，当前 ${raw.length} 组` }
  }

  const items: SubmitItemInput[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i] as { id?: unknown; scanNumber?: unknown; clientCode?: unknown }
    const id = String(row?.id ?? '').trim()
    const scanNumber = String(row?.scanNumber ?? '').trim()
    const clientCode = String(row?.clientCode ?? '').trim()
    if (!id) return { error: `第 ${i + 1} 组缺少 id` }
    if (!scanNumber) return { error: `第 ${i + 1} 组缺少条形码` }
    if (!CLIENT_CODE_RE.test(clientCode)) {
      return { error: `第 ${i + 1} 组商家码非法: ${clientCode || '(空)'}` }
    }
    items.push({ id, scanNumber, clientCode })
  }
  return { items }
}

returnToMerchantRouter.post('/submit', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type SubmitBody = { stationCode?: unknown; items?: unknown }
  const body = req.body as SubmitBody

  const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
  if (!stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }

  const parsed = parseItems(body.items)
  if ('error' in parsed) {
    res.status(400).json({ ok: false, error: parsed.error })
    return
  }

  const semaphore = new Semaphore(SUBMIT_CONCURRENCY)
  const results = await Promise.all(
    parsed.items.map((item) =>
      semaphore.run(async (): Promise<ReturnToMerchantItemResult> => {
        const submitted = await submitReturnToMerchant({
          imileToken: token,
          clientCode: item.clientCode,
          currentStationCode: stationCode,
          scanNumber: item.scanNumber,
        })
        if (!submitted.ok) {
          return { ...item, ok: false, error: submitted.message }
        }
        return {
          ...item,
          ok: true,
          blockCode: submitted.blockCode,
          blockInfo: submitted.blockInfo,
          operateTypeDesc: submitted.operateTypeDesc,
        }
      }),
    ),
  )

  res.json({
    ok: true,
    data: {
      total: results.length,
      successCount: results.filter((r) => r.ok).length,
      results,
    },
  })
})

returnToMerchantRouter.post('/bags', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req, (req.body as { imileToken?: unknown })?.imileToken)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  const body = req.body as { stationCode?: unknown; startDate?: unknown; endDate?: unknown }
  const stationCode = String(body.stationCode ?? '').trim()
  const startDate = String(body.startDate ?? '').trim()
  const endDate = String(body.endDate ?? '').trim()
  if (!stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }
  if (!startDate || !endDate) {
    res.status(400).json({ ok: false, error: '缺少集包创建时间区间' })
    return
  }

  const result = await fetchBagInfo({ imileToken: token, ocCode: stationCode, startDate, endDate })
  if (!result.ok) {
    res.status(result.status >= 400 ? result.status : 502).json({ ok: false, error: result.message })
    return
  }

  res.json({ ok: true, data: { rows: result.rows, total: result.total } })
})
