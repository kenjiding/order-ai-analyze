import { APIError } from 'openai'
import { createDeepSeekClient } from './openaiClient'

const FEISHU_TEXT_CHUNK = 3600

function isSortEfficiencySnapshot(x: unknown): x is { kind: string; periodLabel?: string } {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x) && (x as { kind?: string }).kind === 'sort_efficiency_v1')
}

/** 飞书自定义机器人 text 消息建议控制单条体积，按段落切分 */
export function splitFeishuWebhookTextChunks(text: string, maxLen = FEISHU_TEXT_CHUNK): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= maxLen) return [t]

  const lines = t.split(/\r?\n/)
  const out: string[] = []
  let buf = ''

  const flush = () => {
    const s = buf.trim()
    if (s) out.push(s)
    buf = ''
  }

  for (const line of lines) {
    const candidate = buf.length ? `${buf}\n${line}` : line
    if (candidate.length > maxLen && buf.length) {
      flush()
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          out.push(line.slice(i, i + maxLen))
        }
      } else {
        buf = line
      }
      continue
    }
    if (candidate.length > maxLen && !buf.length) {
      for (let i = 0; i < line.length; i += maxLen) {
        out.push(line.slice(i, i + maxLen))
      }
      continue
    }
    buf = candidate
  }
  flush()
  return out
}

const FEISHU_ANALYSIS_TARGET_CHARS = 100

export async function generateSortEfficiencyFeishuAnalysis(dataSnapshot: unknown): Promise<
  | { ok: true; text: string }
  | { ok: false; error: string; reason: 'bad_input' | 'no_api_key' | 'upstream' }
> {
  if (!isSortEfficiencySnapshot(dataSnapshot)) {
    return { ok: false, error: 'dataSnapshot 不是有效的 sort_efficiency_v1 结构', reason: 'bad_input' }
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, error: '服务器未配置 DEEPSEEK_API_KEY，跳过数据解读', reason: 'no_api_key' }
  }

  const systemPrompt = [
    `你是仓库现场管理，给飞书写「极简数据点评」。请尽量把总字数控制在约 ${FEISHU_ANALYSIS_TARGET_CHARS} 个汉字（可略多略少，以说清为准）；若信息量需要，写长一些也可以，不要为了凑字数硬拆，也不要无意义堆砌。`,
    '输入为 JSON：periodLabel、sorting（汇总/按日/top 扫描员），以及可选 warehouseAttendance。',
    '用语与口径（必须遵守：称呼写对即可，不在正文里展开统计定义）：',
    '① 凡引用 sorting 中的数字（含 sorting.summary.totalEfficiency、totalEffectiveHours、totalScanCount、daily[].efficiency、topScanners[].adjustedEfficiency 等），文中须明确称为「一级分拣效率」或「一级分拣」相关表述；不要把该口径笼统写成「综合效率」「整体效率」而不加「一级分拣」限定。',
    '② warehouseAttendance.overallEfficiency（及 allHours 等考勤全工时依据）须称为「总效率」（考勤/全仓总体口径）；warehouseAttendance.openEfficiency 称为「开仓效率」，勿与一级分拣混淆。',
    '③ 若同一段同时出现一级分拣与考勤侧数字，仅用正确名称各带一句结论即可；禁止展开分母、考勤总工时、有效工时、「不宜/请勿直接对比」等方法论文句；禁止把两类数值写成同一半句让人误以为同一指标。',
    '对扫描员排名、高低值判断时，优先使用 topScanners[].adjustedEfficiency（与页面表格/图表一致）；仅当该字段缺失时，才回退到 rawEfficiency。',
    '只依据数字与字段下笔；不许编造；缺的关键信息就用一句话点出缺口。',
    '面向群里同事：只写结论与关键数字（人次、件数、效率名与数值、名次/高低），不写分母拆解、工时对照、「与…口径不同」「请勿直接对比」等说明套话。',
    '建议一段连续中文：先概括区间分拣整体，再点一句波动/对比或风险提示；尽量不用分点或小标题，除非内容确实需要分层。',
    '禁止输出：markdown、JSON；少用空话套话。',
    '禁止使用这些词或同类表述：人工智能、AI、大模型、自动生成。',
  ].join('\n')

  const userPrompt = [
    `目标篇幅约 ${FEISHU_ANALYSIS_TARGET_CHARS} 字，以实际表达需要为准。`,
    '数据如下（JSON）：',
    JSON.stringify(dataSnapshot),
  ].join('\n')

  try {
    const client = createDeepSeekClient(apiKey)
    const model = process.env.DEEPSEEK_SORT_PUSH_MODEL?.trim() || 'deepseek-chat'
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.25,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    const text = (completion.choices[0]?.message?.content ?? '').trim()
    if (!text) {
      return { ok: false, error: 'DeepSeek 返回空文本', reason: 'upstream' }
    }
    return { ok: true, text }
  } catch (err) {
    if (err instanceof APIError) {
      const msg = [err.message, err.status ? `HTTP ${err.status}` : ''].filter(Boolean).join(' ')
      return { ok: false, error: msg || 'DeepSeek 请求失败', reason: 'upstream' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'DeepSeek 请求异常', reason: 'upstream' }
  }
}
