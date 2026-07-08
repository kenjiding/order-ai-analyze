import { Router, type Request, type Response } from 'express'
import {
  downloadImageAsBase64,
  getProblemPackageDetail,
  searchFeedbackStatistics,
  searchProblemPackages,
} from '../imile/problemPackageAuditApi'
import { createDeepSeekClient, createOpenAIClient } from '../openaiClient'
import { readImileTokenFromRequest } from './imileAuth'
import { buildAuditPrompt } from '../problemPackageAudit/buildAuditPrompt'
import type OpenAI from 'openai'

export const problemPackageAuditRouter = Router()

const MAX_IMAGES_PER_AUDIT = 10

function getVisionModel(): string {
  if (process.env.DEEPSEEK_VISION_MODEL) return process.env.DEEPSEEK_VISION_MODEL
  return process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_ORDER_MODEL ?? 'gpt-4o'
}

function buildVisionClient(openaiKey: string, deepseekKey: string) {
  if (process.env.DEEPSEEK_VISION_MODEL) return createDeepSeekClient(deepseekKey)
  return createOpenAIClient(openaiKey)
}

problemPackageAuditRouter.post('/statistics', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    const token = readImileTokenFromRequest(req, body.imileToken)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }

    const start = String(body.start ?? '').trim()
    const end = String(body.end ?? '').trim()
    const stationCode = String(body.stationCode ?? '').trim()

    if (!start || !end) {
      res.status(400).json({ error: '请提供 start / end 日期' })
      return
    }
    if (!stationCode) {
      res.status(400).json({ error: '请提供 stationCode' })
      return
    }

    const result = await searchFeedbackStatistics({
      imileToken: token,
      start,
      end,
      stationCode,
      currentPage: Number(body.currentPage ?? 1),
      showCount: Number(body.showCount ?? 20),
    })

    if (!result.ok) {
      res.status(502).json({ error: result.message, rawText: result.rawText })
      return
    }

    res.json({ results: result.rows, total: result.total })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '问题件统计查询失败' })
  }
})

problemPackageAuditRouter.post('/search', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    const token = readImileTokenFromRequest(req, body.imileToken)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }

    const daCode = String(body.daCode ?? '').trim()
    const stationCode = String(body.stationCode ?? '').trim()
    const start = String(body.start ?? '').trim()
    const end = String(body.end ?? '').trim()
    const ofdDate = String(body.ofdDate ?? '').trim()

    if (!daCode) {
      res.status(400).json({ error: '请填写 DA 代码 (daCode)' })
      return
    }
    if (!stationCode) {
      res.status(400).json({ error: '请填写站点代码 (stationCode)' })
      return
    }
    if (!start || !end) {
      res.status(400).json({ error: '请选择查询日期范围' })
      return
    }

    const result = await searchProblemPackages({
      imileToken: token,
      daCode,
      stationCode,
      start,
      end,
      ofdDate: ofdDate || end,
      currentPage: Number(body.currentPage ?? 1),
      showCount: Number(body.showCount ?? 20),
      dtlProblemAuditStatus: String(body.dtlProblemAuditStatus ?? ''),
      problemType: String(body.problemType ?? ''),
      problemReason: String(body.problemReason ?? ''),
      waybillNos: Array.isArray(body.waybillNos) ? (body.waybillNos as string[]) : [],
      dtlCode: String(body.dtlCode ?? ''),
      followUpType: String(body.followUpType ?? ''),
      isDtlAudit: String(body.isDtlAudit ?? ''),
      vendorCode: String(body.vendorCode ?? ''),
      vehicleNos: Array.isArray(body.vehicleNos) ? (body.vehicleNos as string[]) : [],
      orderTypeList: Array.isArray(body.orderTypeList) ? (body.orderTypeList as string[]) : [],
      payment: String(body.payment ?? ''),
      stateCode: String(body.stateCode ?? ''),
      consigneeFeedback: String(body.consigneeFeedback ?? ''),
    })

    if (!result.ok) {
      res.status(502).json({ error: result.message, rawText: result.rawText })
      return
    }

    res.json({ results: result.rows, total: result.total })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '问题件列表查询失败' })
  }
})

problemPackageAuditRouter.post('/detail', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    const token = readImileTokenFromRequest(req, body.imileToken)
    const taskId = String(body.taskId ?? '').trim()

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!taskId) {
      res.status(400).json({ error: '缺少 taskId 参数' })
      return
    }

    const result = await getProblemPackageDetail(token, taskId)

    if (!result.ok) {
      res.status(502).json({ error: result.message, rawText: result.rawText })
      return
    }

    res.json({
      problemReasonDesc: result.problemReasonDesc,
      problemRemark: result.problemRemark,
      images: result.images,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '问题件详情查询失败' })
  }
})

problemPackageAuditRouter.post('/ai-analyze', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    const token = readImileTokenFromRequest(req, body.imileToken)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }

    const openaiKey = process.env.OPENAI_API_KEY?.trim() ?? ''
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
    const useDeepSeek = !!process.env.DEEPSEEK_VISION_MODEL
    const apiKey = useDeepSeek ? deepseekKey : openaiKey

    if (!apiKey) {
      const missing = useDeepSeek ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'
      res.status(500).json({ error: `服务端未配置 ${missing}，无法执行 AI 审核` })
      return
    }

    const images = Array.isArray(body.images) ? (body.images as string[]) : []
    const problemReasonDesc = String(body.problemReasonDesc ?? '')
    const problemRemark = String(body.problemRemark ?? '')

    if (images.length === 0) {
      res.status(400).json({ error: '该问题件没有上传图片，无法进行 AI 审核' })
      return
    }

    const limitedImages = images.slice(0, MAX_IMAGES_PER_AUDIT)

    // Download images and convert to base64
    const imageResults = await Promise.all(
      limitedImages.map(async (url, i) => {
        try {
          const { dataUrl } = await downloadImageAsBase64(url, token)
          return { index: i, dataUrl, error: null }
        } catch (e) {
          return { index: i, dataUrl: null, error: (e as Error).message }
        }
      }),
    )

    const validImages = imageResults.filter((r) => r.dataUrl !== null)
    if (validImages.length === 0) {
      res.status(502).json({ error: '所有图片下载失败，无法进行 AI 审核' })
      return
    }

    // Build OpenAI content blocks with interleaved text + image
    const contentBlocks: OpenAI.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: buildAuditPrompt({ problemReasonDesc, problemRemark, imageCount: validImages.length }),
      },
    ]

    for (const img of validImages) {
      contentBlocks.push({ type: 'text', text: `图片${img.index}：` })
      contentBlocks.push({
        type: 'image_url',
        image_url: { url: img.dataUrl!, detail: 'high' },
      })
    }

    const openai = buildVisionClient(openaiKey, deepseekKey)
    const model = getVisionModel()

    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: contentBlocks }],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    })

    const rawContent = completion.choices[0]?.message?.content ?? '{}'

    let parsed: { results?: unknown[] } = {}
    try {
      parsed = JSON.parse(rawContent) as { results?: unknown[] }
    } catch {
      res.status(500).json({ error: 'AI 返回格式解析失败', rawContent })
      return
    }

    const resultItems = Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : []

    // Merge download errors back as unqualified
    const finalResults = limitedImages.map((_, i) => {
      const downloadError = imageResults.find((r) => r.index === i && r.error)
      if (downloadError) {
        return {
          index: i,
          address: '',
          imageType: '未知',
          qualified: false,
          reason: `图片加载失败: ${downloadError.error}`,
        }
      }
      const aiResult = resultItems.find(
        (r) => (r as { index?: number }).index === i,
      ) as
        | { index: number; address?: string; observation?: string; imageType?: string; qualified?: boolean; reason?: string }
        | undefined
      if (!aiResult) {
        return { index: i, address: '', imageType: '未知', qualified: false, reason: 'AI 未返回该图片结果' }
      }
      return {
        index: i,
        address: aiResult.address ?? '',
        observation: aiResult.observation,
        imageType: aiResult.imageType ?? '未知',
        qualified: aiResult.qualified !== false,
        reason: aiResult.reason ?? '',
      }
    })

    // ── 结构性校验 ──────────────────────────────────────────────────────────
    const validationErrors: string[] = []

    // 规则 1：任何问题类型都必须有一张快递面单图片
    const hasWaybill = finalResults.some((r) => r.imageType === '快递面单')
    if (!hasWaybill) {
      validationErrors.push('缺少快递面单图片（所有问题件审核均需要包含快递面单照片）')
    }

    // 规则 2：地址错误类型必须有地址相关图片（门牌号 或 Google Maps 截图）
    const isAddressError = ['地址错误', '地址不符', '地址有误', '找不到地址', '地址不存在', 'wrong address', 'address not found']
      .some((kw) => problemReasonDesc.toLowerCase().includes(kw.toLowerCase()))
    if (isAddressError) {
      const hasAddressEvidence = finalResults.some(
        (r) => r.imageType === '门牌号' || r.imageType.includes('Google Maps') || r.imageType.includes('地图'),
      )
      if (!hasAddressEvidence) {
        validationErrors.push('地址错误类问题件须提供地址相关图片（门牌号照片或 Google Maps 截图）')
      }
    }

    const allDownloadsOk = imageResults.every((r) => r.error === null)
    const imageLevelOk = resultItems.every(
      (item) => (item as { qualified?: boolean }).qualified !== false,
    )

    res.json({
      overallQualified: imageLevelOk && allDownloadsOk && validationErrors.length === 0,
      imageResults: finalResults,
      validationErrors,
      model,
      usage: completion.usage,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || 'AI 审核失败' })
  }
})
