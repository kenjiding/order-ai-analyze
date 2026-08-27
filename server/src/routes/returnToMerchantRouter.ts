import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { readImileTokenFromRequest } from './imileAuth'
import { submitReturnToMerchant } from '../imile/returnToMerchant'
import { Semaphore } from '../imile/semaphore'
import { isReturnMerchantCode } from '../../../shared/returnToMerchant/merchants'

export const returnToMerchantRouter = Router()

/** 单次批量上限：移动端一次扫这么多已经够用，超出直接拒绝而不是静默截断 */
const MAX_ITEMS = 200
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
    if (!isReturnMerchantCode(clientCode)) {
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
