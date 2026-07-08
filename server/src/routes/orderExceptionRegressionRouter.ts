import { Router, type Request, type Response } from 'express'
import type { AiLossScope } from '../orderAnalyze/types'
import { fetchOrderExceptionSourcesForAnalyze } from './orderExceptionData'
import {
  deleteFixture,
  getFixture,
  listFixtures,
  upsertFixture,
} from '../orderAnalyze/regression/fixtureStore'
import { getRegressionFixtureDetail, runOrderAnalyzeRegression } from '../orderAnalyze/regression/runRegression'
import type { OrderAnalyzeRegressionFixture } from '../orderAnalyze/regression/types'
import type { OrderAnalyzeAiProvider } from '../orderAnalyze/pipeline'

export function registerOrderExceptionRegressionRoutes(
  router: Router,
  deps: {
    readJson: <T>(req: Request) => T
    readImileToken: (req: Request, bodyToken: unknown) => string
    queryTracksWithCache: (
      token: string,
      orderNos: string[]
    ) => Promise<
      | { ok: true; trackInfo: Record<string, import('../imile/track').TrackEvent[]>; raw?: unknown }
      | { ok: false; message: string; status?: number; rawText?: string }
    >
  }
): void {
  const { readJson, readImileToken } = deps

  router.get('/regression/cases', async (_req: Request, res: Response) => {
    try {
      const cases = await listFixtures()
      res.json({ cases })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '获取用例列表失败' })
    }
  })

  router.get('/regression/cases/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? '').trim()
      const detail = await getRegressionFixtureDetail(id)
      if (!detail) {
        res.status(404).json({ error: '用例不存在' })
        return
      }
      res.json({ case: detail })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '获取用例详情失败' })
    }
  })

  router.post('/regression/capture', async (req: Request, res: Response) => {
    try {
      const body = readJson<{
        imileToken?: string
        orderNo?: string
        expected?: {
          lossScope?: string
          exceptionCategoryId?: string
          reason?: string
        }
      }>(req)
      const token = readImileToken(req, body.imileToken)
      const orderNo = String(body.orderNo ?? '').trim()
      if (!token) {
        res.status(400).json({ error: '缺少 imileToken' })
        return
      }
      if (!orderNo) {
        res.status(400).json({ error: '请提供 orderNo' })
        return
      }
      const lossScope = String(body.expected?.lossScope ?? '').trim() as AiLossScope
      if (!lossScope) {
        res.status(400).json({ error: '请提供 expected.lossScope' })
        return
      }

      const sourceResult = await fetchOrderExceptionSourcesForAnalyze(token, [orderNo])
      if (!sourceResult.ok) {
        res.status(502).json({
          error: sourceResult.message,
          status: sourceResult.status,
          rawText: sourceResult.rawText,
        })
        return
      }

      const tracks = sourceResult.trackInfo[orderNo] ?? []
      if (!tracks.length) {
        res.status(400).json({ error: '未获取到轨迹数据' })
        return
      }

      const interceptLogs = sourceResult.interceptLogs[orderNo] ?? []

      const fixture: OrderAnalyzeRegressionFixture = {
        id: orderNo,
        orderNo,
        capturedAt: new Date().toISOString(),
        expected: {
          lossScope,
          exceptionCategoryId: String(body.expected?.exceptionCategoryId ?? '').trim(),
          reason: String(body.expected?.reason ?? '').trim(),
        },
        tracks,
        interceptLogs,
      }

      const saved = await upsertFixture(fixture)
      res.json({ case: saved })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '录入用例失败' })
    }
  })

  router.delete('/regression/cases/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id ?? '').trim()
      const deleted = await deleteFixture(id)
      if (!deleted) {
        res.status(404).json({ error: '用例不存在' })
        return
      }
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '删除用例失败' })
    }
  })

  router.post('/regression/run', async (req: Request, res: Response) => {
    try {
      const body = readJson<{ caseIds?: string[]; aiProvider?: string; enableDualRunCompare?: boolean }>(req)
      const aiProviderRaw = String(body.aiProvider ?? 'deepseek').trim().toLowerCase()
      const aiProvider: OrderAnalyzeAiProvider =
        aiProviderRaw === 'openai' ? 'openai' : 'deepseek'
      const caseIds = Array.isArray(body.caseIds)
        ? body.caseIds.map((s) => String(s).trim()).filter(Boolean)
        : undefined

      if (caseIds?.length) {
        for (const id of caseIds) {
          const f = await getFixture(id)
          if (!f) {
            res.status(404).json({ error: `用例不存在: ${id}` })
            return
          }
        }
      }

      const report = await runOrderAnalyzeRegression({
        caseIds,
        aiProvider,
        enableDualRunCompare: body.enableDualRunCompare === true,
      })
      res.json(report)
    } catch (e) {
      res.status(500).json({ error: (e as Error).message || '回归测试失败' })
    }
  })
}
