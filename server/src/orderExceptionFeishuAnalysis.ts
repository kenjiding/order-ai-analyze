import { APIError } from 'openai'
import { createDeepSeekClient, createOpenAIClient } from './openaiClient'

export type OrderExceptionPushRow = {
  lossScope: string
  categoryName: string
  currentResponsibilityParty: string
  confidence: string
}

export type OrderExceptionPushStats = {
  totalCount: number
  byLossScope: Record<string, number>
  byResponsibility: Record<string, number>
  topCategories: Array<{ name: string; count: number }>
  analysisDate: string
}

export function buildOrderExceptionPushStats(rows: OrderExceptionPushRow[], analysisDate: string): OrderExceptionPushStats {
  const byLossScope: Record<string, number> = {}
  const byResponsibility: Record<string, number> = {}
  const byCategoryName: Record<string, number> = {}

  for (const row of rows) {
    const scope = row.lossScope || '未知'
    byLossScope[scope] = (byLossScope[scope] ?? 0) + 1

    const resp = row.currentResponsibilityParty || '未知'
    byResponsibility[resp] = (byResponsibility[resp] ?? 0) + 1

    const cat = row.categoryName || '未分类'
    byCategoryName[cat] = (byCategoryName[cat] ?? 0) + 1
  }

  const topCategories = Object.entries(byCategoryName)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return { totalCount: rows.length, byLossScope, byResponsibility, topCategories, analysisDate }
}

/** 用 DeepSeek 或 OpenAI 生成约 80~150 字的中文总结，口气像现场运营负责人 */
export async function generateOrderExceptionFeishuSummary(
  stats: OrderExceptionPushStats,
  aiProvider: 'deepseek' | 'openai' = 'deepseek',
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const systemPrompt = [
    '你是仓库运营负责人，给飞书群写「订单异常分析简报」。',
    '字数控制在 80～150 个汉字，口气简洁直接，像工作汇报，不要套话。',
    '必须指出核心问题类型和责任归属，重点说需要关注或改善的方向。',
    '禁止出现：AI、人工智能、大模型、算法、综上所述、值得注意的是。',
    '只输出纯文本，不要 markdown 格式。',
  ].join('\n')

  const userPrompt = [
    `以下是 ${stats.analysisDate} 本次 AI 订单异常分析结果，请写一段简报：`,
    JSON.stringify({
      总分析订单数: stats.totalCount,
      按异常类型分布: stats.byLossScope,
      按责任方分布: stats.byResponsibility,
      Top子分类: stats.topCategories,
    }),
  ].join('\n')

  try {
    if (aiProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY?.trim()
      if (!apiKey) return { ok: false, error: '未配置 OPENAI_API_KEY' }
      const client = createOpenAIClient(apiKey)
      const completion = await client.chat.completions.create({
        model: process.env.OPENAI_WEEKLY_MODEL ?? 'gpt-4.1-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
      const text = (completion.choices[0]?.message?.content ?? '').trim()
      if (!text) return { ok: false, error: 'AI 返回为空' }
      return { ok: true, text }
    } else {
      const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
      if (!apiKey) return { ok: false, error: '未配置 DEEPSEEK_API_KEY' }
      const client = createDeepSeekClient(apiKey)
      const completion = await client.chat.completions.create({
        model: process.env.DEEPSEEK_WEEKLY_MODEL ?? 'deepseek-chat',
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
      const text = (completion.choices[0]?.message?.content ?? '').trim()
      if (!text) return { ok: false, error: 'AI 返回为空' }
      return { ok: true, text }
    }
  } catch (err) {
    if (err instanceof APIError) return { ok: false, error: `AI 服务错误：${err.message}` }
    return { ok: false, error: 'AI 服务网络请求失败' }
  }
}

// ─── 卡片构建工具函数（仿 buildNewMerchantCard 风格） ───────────────────────

type CardEl = Record<string, unknown>
type MarkColor = 'red' | 'orange' | 'green' | 'grey' | 'blue'

function div(content: string): CardEl {
  return { tag: 'div', text: { tag: 'lark_md', content } }
}
function hr(): CardEl {
  return { tag: 'hr' }
}
function note(content: string): CardEl {
  return { tag: 'note', elements: [{ tag: 'lark_md', content }] }
}
function colored(value: string, color: MarkColor): string {
  return `<font color='${color}'>${value}</font>`
}

const BAR_FULL = '█'
const BAR_EMPTY = '░'
function makeBar(pct: number, segs = 10): string {
  if (!Number.isFinite(pct) || pct <= 0) return BAR_EMPTY.repeat(segs)
  const filled = Math.min(segs, Math.max(0, Math.round((pct / 100) * segs)))
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(segs - filled)
}

function columnSet(
  columns: CardEl[],
  flexMode: 'bisect' | 'trisect' | 'flow' | 'stretch' = 'bisect',
): CardEl {
  return { tag: 'column_set', flex_mode: flexMode, background_style: 'default', columns }
}

function kpiTile(swatch: string, label: string, value: string, sub: string, valueColor: MarkColor): CardEl {
  const lines = [`${swatch} **${label}**`, colored(`**${value}**`, valueColor)]
  if (sub) lines.push(colored(sub, 'grey'))
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    background_style: 'grey',
    elements: [div(lines.join('\n'))],
  }
}

// 责任方色块：单量越多越红
function respColor(count: number, maxCount: number): { color: MarkColor; swatch: string } {
  const ratio = maxCount > 0 ? count / maxCount : 0
  if (ratio >= 0.5) return { color: 'red', swatch: '🔴' }
  if (ratio >= 0.25) return { color: 'orange', swatch: '🟠' }
  return { color: 'green', swatch: '🟢' }
}

/** 构建飞书富文本卡片（webhook v1 interactive card） */
export function buildOrderExceptionFeishuCard(
  stats: OrderExceptionPushStats,
  aiSummary: string | null,
): Record<string, unknown> {
  const elements: CardEl[] = []

  const lossScopeSorted = Object.entries(stats.byLossScope).sort((a, b) => b[1] - a[1])
  const respSorted = Object.entries(stats.byResponsibility).sort((a, b) => b[1] - a[1])
  const topResp = respSorted[0]

  // ── AI 总结 ──
  if (aiSummary) {
    elements.push(div(`🤖 **AI 分析总结**\n${aiSummary}`))
    elements.push(hr())
  }

  // ── KPI 磁贴：总量 + 主要异常类型 ──
  const topScope = lossScopeSorted[0]
  elements.push(
    columnSet([
      kpiTile('📦', '本次分析总量', `${stats.totalCount} 单`, stats.analysisDate, 'blue'),
      topScope
        ? kpiTile(
            '⚠️',
            '最高异常类型',
            topScope[0],
            `${topScope[1]} 单 · ${((topScope[1] / stats.totalCount) * 100).toFixed(1)}%`,
            'red',
          )
        : kpiTile('⚠️', '最高异常类型', '—', '暂无数据', 'grey'),
    ], 'bisect'),
  )

  // ── KPI 磁贴：最高责任方 + 子分类数 ──
  const catCount = Object.keys(stats.topCategories).length
  elements.push(
    columnSet([
      topResp
        ? kpiTile(
            '⚖️',
            '最高责任站点',
            topResp[0],
            `${topResp[1]} 单 · ${((topResp[1] / stats.totalCount) * 100).toFixed(1)}%`,
            'orange',
          )
        : kpiTile('⚖️', '最高责任站点', '—', '暂无数据', 'grey'),
      kpiTile('🔖', '命中子分类数', `${catCount} 类`, `Top1：${stats.topCategories[0]?.name ?? '—'}`, 'green'),
    ], 'bisect'),
  )

  elements.push(hr())

  // ── 异常类型分布（进度条） ──
  elements.push(div('📊 **异常类型分布**'))
  const scopeLines = lossScopeSorted.map(([k, v]) => {
    const pct = (v / stats.totalCount) * 100
    const bar = makeBar(pct)
    const pctStr = `${pct.toFixed(1)}%`
    const color: MarkColor = pct >= 40 ? 'red' : pct >= 20 ? 'orange' : 'green'
    return `${k.padEnd(6, '　')} ${bar} ${colored(pctStr, color)} ${colored(`(${v}单)`, 'grey')}`
  })
  elements.push(div(scopeLines.join('\n')))

  elements.push(hr())

  // ── 责任方分布（色块磁贴，每行两个，最多显示 8 个） ──
  const maxRespCount = respSorted[0]?.[1] ?? 1
  const topResps = respSorted.slice(0, 8)
  elements.push(div('⚖️ **责任方分布**（Top ' + topResps.length + '）'))

  // 每两个一行
  for (let i = 0; i < topResps.length; i += 2) {
    const pair = topResps.slice(i, i + 2)
    const cols = pair.map(([name, cnt]) => {
      const { color, swatch } = respColor(cnt, maxRespCount)
      return kpiTile(swatch, name, `${cnt} 单`, `${((cnt / stats.totalCount) * 100).toFixed(1)}%`, color)
    })
    if (cols.length === 1) {
      // 补一个空白列保持对齐
      cols.push({ tag: 'column', width: 'weighted', weight: 1, elements: [] })
    }
    elements.push(columnSet(cols, 'bisect'))
  }

  // ── Top 子分类列表 ──
  if (stats.topCategories.length > 0) {
    elements.push(hr())
    elements.push(div('🔖 **高频子分类 Top ' + stats.topCategories.length + '**'))
    const catLines = stats.topCategories.map((c, i) => {
      const pct = (c.count / stats.totalCount) * 100
      const bar = makeBar(pct, 8)
      return `${i + 1}. **${c.name}** ${bar} ${colored(`${c.count}单`, 'grey')}`
    })
    elements.push(div(catLines.join('\n')))
  }

  elements.push(hr())
  elements.push(note(`${stats.analysisDate} · iMile 仓库管理系统 · AI 订单异常分析`))

  // header 颜色：库内/库外丢失超过 50% 用红，否则橙
  const mainLossCount = (stats.byLossScope['库内丢失'] ?? 0) + (stats.byLossScope['库外丢失'] ?? 0)
  const headerTemplate = mainLossCount / stats.totalCount >= 0.5 ? 'red' : 'orange'

  return {
    config: { wide_screen_mode: true },
    header: {
      template: headerTemplate,
      title: { tag: 'plain_text', content: `AI 订单异常分析报告 · ${stats.analysisDate}` },
    },
    elements,
  }
}
