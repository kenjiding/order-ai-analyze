import { APIError } from 'openai'
import { Router, type Request, type Response } from 'express'
import { createDeepSeekClient, createOpenAIClient } from '../openaiClient'

type WeeklyAiProvider = 'openai' | 'deepseek'

type WeeklyAiRequestBody = {
  aiProvider?: WeeklyAiProvider
  periodStart?: string
  periodEnd?: string
  summaryText?: string
  currentMetrics?: Record<string, number | null>
  previousMetrics?: Record<string, number | null> | null
  fallback?: {
    conclusions?: string[]
    diagnostics?: { label?: string; value?: string; text?: string }[]
    actions?: string[]
  }
}

export const weeklyReportInsightRouter = Router()

weeklyReportInsightRouter.post('/', async (req: Request, res: Response) => {
  const payload = req.body as WeeklyAiRequestBody
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ error: '请求体须为 JSON 对象' })
    return
  }

  const promptData = {
    periodStart: payload.periodStart || '',
    periodEnd: payload.periodEnd || '',
    summaryText: payload.summaryText || '',
    currentMetrics: payload.currentMetrics || {},
    previousMetrics: payload.previousMetrics || null,
    fallback: payload.fallback || { conclusions: [], diagnostics: [], actions: [] },
  }
  const aiProvider: WeeklyAiProvider = payload.aiProvider === 'openai' ? 'openai' : 'deepseek'

  const systemPrompt = [
    '你写的是仓库运营周报里给管理层看的「研判」文字，口气要像带班主管或现场负责人：利落、具体、敢说判断，但别夸张、别堆套话。',
    '只输出一个 JSON 对象，字段为 summary、prediction、prevention（都是字符串数组），不要 markdown，不要代码围栏。',
    '只能依据输入里的数字和事实下笔；缺什么数据就直说缺什么，只能先怎么保守处理，禁止编造指标或假装有数据。',
    '正文里禁止出现这些字眼或同义替代表述：人工智能、AI、大模型、ChatGPT、机器学习、算法、模型、自动生成、智能助手、机器人。',
    '禁止使用这类开头或废话：综上所述、总而言之、值得注意的是、整体而言、不难发现。',
    '每条一至两句话即可，少用「优化/赋能/沉淀」等空话；预测要交代依据，预防要写清谁做什么事、核对什么。',
  ].join('\n')

  const userPrompt = [
    '结合下面这份周报材料，写出三段',
    '—— summary：本期到底怎么样（货量、开仓/总体效率、分拣、考勤匹配等，扣住数字说人话，3～5 条）；',
    '—— prediction：下周大概会怎么走、要盯哪些坑（2～4 条，跟本期数据挂钩，可以是判断但不要拍脑袋）；',
    '—— prevention：下周要先动手的预防/整改清单（3～6 条，写得像工作布置）。',
    '材料：',
    JSON.stringify(promptData),
  ].join(' ')

  let completion
  try {
    if (aiProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        res.status(500).json({ error: '未配置 OPENAI_API_KEY，无法生成周报研判段落' })
        return
      }
      const openai = createOpenAIClient(apiKey)
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_WEEKLY_MODEL ?? 'gpt-4.1-mini',
        temperature: 0.35,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'weekly_report_weekly_insight',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'array', items: { type: 'string' } },
                prediction: { type: 'array', items: { type: 'string' } },
                prevention: { type: 'array', items: { type: 'string' } },
              },
              required: ['summary', 'prediction', 'prevention'],
            },
          },
        },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
    } else {
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) {
        res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY，无法生成周报研判段落' })
        return
      }
      const client = createDeepSeekClient(apiKey)
      completion = await client.chat.completions.create({
        model: process.env.DEEPSEEK_WEEKLY_MODEL ?? 'deepseek-chat',
        temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${systemPrompt}\n你必须仅输出 JSON 对象，禁止 markdown 代码块。` },
          { role: 'user', content: userPrompt },
        ],
      })
    }
  } catch (err) {
    if (err instanceof APIError) {
      const msg = [err.message, err.status ? `HTTP ${err.status}` : ''].filter(Boolean).join(' ')
      res.status(502).json({ error: `研判文案服务请求失败。${msg}`.trim() })
      return
    }
    res.status(502).json({ error: '研判文案服务网络请求失败，请稍后重试。' })
    return
  }

  try {
    const rawContent = completion.choices[0]?.message?.content ?? ''
    const analysis = JSON.parse(rawContent)
    res.json({ analysis })
  } catch {
    res.status(502).json({ error: '研判文案服务返回异常或格式异常，请稍后重试。' })
  }
})
