import { APIError } from 'openai'
import { Router, type Request, type Response } from 'express'
import { createDeepSeekClient, createOpenAIClient } from '../openaiClient'

type AiProvider = 'openai' | 'deepseek'

type WarehouseInsightPayload = {
  tab: 'warehouse'
  aiProvider?: AiProvider
  openEfficiency: number
  overallEfficiency: number
  uploadedVolume: number
  openHours: number
  allHours: number
  openDayCount: number
  totalDays: number
  dailyRows: { date: string; volume: number; totalHours: number; isOpenDay: boolean; dayEfficiency: number | null }[]
}

type TopPerformerCandidatePayload = {
  scanner: string
  scanCount: number
  activeDays: number
  cainiaoShare: number
  cainiaoAdjustedEfficiency: number
  cainiaoAdjustedTotalEfficiency: number | null
  attendanceTotalHours: number | null
  compositeScore: number
}

type ScannerInsightPayload = {
  tab: 'scanner'
  aiProvider?: AiProvider
  totalEfficiency: number
  totalScanCount: number
  totalEffectiveHours: number
  totalScanners: number
  totalDays: number
  scannerRows: {
    scanner: string
    scanCount: number
    cainiaoShare: number
    activeDays: number
    effectiveHours: number
    rawEfficiency: number
    cainiaoAdjustedEfficiency: number
  }[]
  /** 已由前端按加权评分确定的 Top 3，AI 只需生成推荐依据文案 */
  topPerformerCandidates: TopPerformerCandidatePayload[]
}

type PersonnelSnapshotItem = {
  name: string
  hours: number
  role: string
  isFrontDesk: boolean
}

type ScannerSnapshotItem = {
  name: string
  scanCount: number
  rawEfficiency: number
  adjustedEfficiency: number
  cainiaoShare: number
}

type DaySnapshot = {
  date: string
  dayEfficiency: number | null
  volume: number
  totalHours: number
  sorterCount: number
  frontDeskHours: number
  sorterHours: number
  frontDeskSharePct: number
  cainiaoShare: number
  laborCost: number | null
  personnel: PersonnelSnapshotItem[]
  scanners: ScannerSnapshotItem[]
}

type CompareInsightPayload = {
  tab: 'compare'
  aiProvider?: AiProvider
  daySnapshots: DaySnapshot[]
  bestDate: string
  worstDate: string
  efficiencyGapPct: number
}

type EfficiencyInsightPayload = WarehouseInsightPayload | ScannerInsightPayload | CompareInsightPayload

export type EfficiencyAiAnalysis = {
  findings: string[]
  suggestions: string[]
  topPerformerReasons: string[]
}

const asStringArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x ?? '').trim()).filter(Boolean)
}

const formatFixed = (v: unknown, digits = 2): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : null


export const efficiencyInsightRouter = Router()

efficiencyInsightRouter.post('/', async (req: Request, res: Response) => {
  const payload = req.body as EfficiencyInsightPayload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ error: '请求体须为 JSON 对象' })
    return
  }

  const aiProvider: AiProvider = (payload as { aiProvider?: AiProvider }).aiProvider === 'openai' ? 'openai' : 'deepseek'

  const systemPrompt = [
    '你是仓库运营分析助手，口气简洁、专业，像现场主管写给管理层的备注。',
    '只输出一个 JSON 对象，scanner tab 时字段为 findings、suggestions、topPerformerReasons；warehouse tab 时字段为 findings、suggestions（topPerformerReasons 置空数组）。',
    '不要 markdown，不要代码围栏。每条 1～2 句话，直接扣数字说人话。',
    '禁止出现：AI、人工智能、大模型、算法、模型、智能助手。',
    '禁止套话：综上所述、总而言之、值得注意的是。',
    '缺数据直说缺什么，不要编造。',
  ].join('\n')

  let userPrompt: string
  if (payload.tab === 'compare') {
    const { daySnapshots, bestDate, worstDate, efficiencyGapPct } = payload
    userPrompt = [
      `请深度分析以下多日效率对比数据，找出导致"总效率"差距（最大差距 ${efficiencyGapPct.toFixed(1)}%）的真实原因，输出 findings（4～6 条：必须结合具体人员名单、工时数字、扫描效率说明问题）和 suggestions（3～5 条：具体可执行的改善措施）。`,
      `效率最高日：${bestDate}，效率最低日：${worstDate}。`,
      '',
      '按日详细数据（含人员构成和扫描员表现）：',
      JSON.stringify(
        daySnapshots.map((d) => ({
          日期: d.date,
          标注: d.date === bestDate ? '【效率最高日】' : d.date === worstDate ? '【效率最低日】' : '',
          当日效率_票每小时: formatFixed(d.dayEfficiency),
          货量_票: d.volume,
          总工时_小时: formatFixed(d.totalHours),
          分拣人数: d.sorterCount,
          分拣员工时_小时: formatFixed(d.sorterHours),
          前台工时_小时: formatFixed(d.frontDeskHours),
          前台工时占比_pct: formatFixed(d.frontDeskSharePct * 100, 1),
          菜鸟占比_pct: formatFixed(d.cainiaoShare * 100, 1),
          人工成本: d.laborCost != null ? formatFixed(d.laborCost, 0) : null,
          人员名单: d.personnel.map((p) => ({
            姓名: p.name,
            工时: formatFixed(p.hours, 1),
            角色: p.role,
            是否前台: p.isFrontDesk,
          })),
          分拣员扫描效率: d.scanners.slice(0, 15).map((s) => ({
            扫描员: s.name,
            扫描量: s.scanCount,
            原始效率_票每小时: formatFixed(s.rawEfficiency),
            修正效率_票每小时: formatFixed(s.adjustedEfficiency),
            菜鸟占比_pct: formatFixed(s.cainiaoShare * 100, 1),
          })),
        })),
      ),
    ].join('\n')
  } else if (payload.tab === 'warehouse') {
    userPrompt = [
      '请分析以下开仓效率 / 总体效率数据，输出 findings（3～5 条：数据亮点或问题）和 suggestions（2～4 条：具体改进建议）：',
      JSON.stringify({
        开仓效率_票每小时: payload.openEfficiency,
        总体效率_票每小时: payload.overallEfficiency,
        总货量_票: payload.uploadedVolume,
        开仓日工时_小时: payload.openHours,
        全部工时_小时: payload.allHours,
        开仓天数: payload.openDayCount,
        统计总天数: payload.totalDays,
        按日明细_最多20条: payload.dailyRows.slice(0, 20).map((r) => ({
          日期: r.date,
          货量: r.volume,
          工时: r.totalHours,
          是否开仓日: r.isOpenDay,
          当日效率: formatFixed(r.dayEfficiency),
        })),
      }),
    ].join('\n')
  } else {
    userPrompt = [
      '请分析以下分拣员个人效率数据，输出三个字段：',
      '① findings（3～5 条字符串：数据亮点或问题）',
      '② suggestions（2～4 条字符串：具体改进建议）',
      '③ topPerformerReasons（恰好 3 条字符串，顺序与 topPerformerCandidates 一一对应：每条 1～2 句，须引用该员工的实际数字说明其在出勤天数、修正效率、总效率方面的具体表现，禁止泛泛而谈）',
      '',
      JSON.stringify({
        一级分拣整体效率_票每小时: payload.totalEfficiency,
        总扫描量_票: payload.totalScanCount,
        有效工时_小时: payload.totalEffectiveHours,
        扫描员人数: payload.totalScanners,
        统计天数: payload.totalDays,
        扫描员明细: payload.scannerRows.slice(0, 30).map((r) => {
          const cainiaoPct = formatFixed((r.cainiaoShare ?? 0) * 100, 1)
          return {
            扫描员: r.scanner,
            扫描量: r.scanCount,
            菜鸟占比: cainiaoPct != null ? `${cainiaoPct}%` : null,
            扫描活跃天数: r.activeDays,
            有效工时_小时: formatFixed(r.effectiveHours),
            原始效率: formatFixed(r.rawEfficiency),
            修正效率_含菜鸟修正: formatFixed(r.cainiaoAdjustedEfficiency),
          }
        }),
        topPerformerCandidates: payload.topPerformerCandidates.map((c) => {
          const cainiaoPct = formatFixed((c.cainiaoShare ?? 0) * 100, 1)
          return {
            扫描员: c.scanner,
            扫描量: c.scanCount,
            扫描活跃天数: c.activeDays,
            菜鸟占比: cainiaoPct != null ? `${cainiaoPct}%` : null,
            修正效率_含菜鸟: formatFixed(c.cainiaoAdjustedEfficiency),
            总效率_含菜鸟: formatFixed(c.cainiaoAdjustedTotalEfficiency),
            考勤总工时_小时: formatFixed(c.attendanceTotalHours),
            综合评分: formatFixed(c.compositeScore, 4),
          }
        }),
      }),
    ].join('\n')
  }

  let completion
  try {
    if (aiProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        res.status(500).json({ error: '未配置 OPENAI_API_KEY' })
        return
      }
      const openai = createOpenAIClient(apiKey)
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_WEEKLY_MODEL ?? 'gpt-4.1-mini',
        temperature: 0.1,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'efficiency_insight',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                findings: { type: 'array', items: { type: 'string' } },
                suggestions: { type: 'array', items: { type: 'string' } },
                topPerformerReasons: { type: 'array', items: { type: 'string' } },
              },
              required: ['findings', 'suggestions', 'topPerformerReasons'],
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
        res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY' })
        return
      }
      const client = createDeepSeekClient(apiKey)
      completion = await client.chat.completions.create({
        model: process.env.DEEPSEEK_WEEKLY_MODEL ?? 'deepseek-chat',
        temperature: 0.1,
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
      res.status(502).json({ error: `AI 服务请求失败。${msg}`.trim() })
      return
    }
    res.status(502).json({ error: 'AI 服务网络请求失败，请稍后重试。' })
    return
  }

  try {
    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const analysis: EfficiencyAiAnalysis = {
      findings: asStringArray(parsed.findings),
      suggestions: asStringArray(parsed.suggestions),
      topPerformerReasons: asStringArray(parsed.topPerformerReasons),
    }
    if (!analysis.findings.length && !analysis.suggestions.length) {
      res.status(502).json({ error: 'AI 返回内容为空，请稍后重试。' })
      return
    }
    res.json({ analysis })
  } catch {
    res.status(502).json({ error: 'AI 返回格式异常，请稍后重试。' })
  }
})
