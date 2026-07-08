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

  const OVERALL_EFFICIENCY_TARGET = 140 // 总体效率目标值（票/小时）

  const systemPrompt = [
    `你是仓库现场管理，给飞书写「极简数据点评」。请尽量把总字数控制在约 ${FEISHU_ANALYSIS_TARGET_CHARS} 个汉字（可略多略少，以说清为准）；若信息量需要，写长一些也可以，不要为了凑字数硬拆，也不要无意义堆砌。`,
    '输入为 JSON：periodLabel、sorting（汇总/按日/top 扫描员），以及可选 warehouseAttendance。',
    '用语与口径（必须遵守：称呼写对即可，不在正文里展开统计定义）：',
    '① 凡引用 sorting 中的数字（含 sorting.summary.totalEfficiency、totalEffectiveHours、totalScanCount、daily[].efficiency、topScanners[].adjustedEfficiency 等），文中须明确称为「一级分拣效率」或「一级分拣」相关表述；不要把该口径笼统写成「综合效率」「整体效率」而不加「一级分拣」限定。',
    '② warehouseAttendance.overallEfficiency（及 allHours 等考勤全工时依据）须称为「总效率」（考勤/全仓总体口径）；warehouseAttendance.openEfficiency 称为「开仓效率」，勿与一级分拣混淆。',
    '③ 若同一段同时出现一级分拣与考勤侧数字，仅用正确名称各带一句结论即可；禁止展开分母、考勤总工时、有效工时、「不宜/请勿直接对比」等方法论文句；禁止把两类数值写成同一半句让人误以为同一指标。',
    `④ 总效率好坏的唯一判断标准是与 ${OVERALL_EFFICIENCY_TARGET} 票/小时对比（不要在正文里写出这个数字）：实际值 > ${OVERALL_EFFICIENCY_TARGET} = 偏高/良好；实际值 < ${OVERALL_EFFICIENCY_TARGET} = 偏低/不足；相差 5% 以内可写「正常」。warehouseAttendance 存在时，须报出总效率实际值并给出这句定性评价。`,
    '⑤ warehouseAttendance.cainiaoShareOpenDays 是开仓日菜鸟票占比（0~1），cainiaoShareWindow 是全窗口菜鸟票占比。菜鸟件处理流程相对简单，菜鸟占比越高效率天然越高，菜鸟占比越低效率天然越低。菜鸟占比只用来解释效率结果的成因，不影响好坏判断（好坏判断只看④中的基准）。须：',
    `   a. 用百分比报出本期菜鸟占比（如「菜鸟占比 XX%」）；`,
    `   b. 用菜鸟占比客观说明成因即可，须先报出占比数字再给结论，句式类似「菜鸟占比 XX%，对效率有一定支撑」；占比较低时仍能维持高效则说明人效突出。不要展开「流程较简单」等原因描述，也不重新给效率下好坏定论。措辞要中性、正面，禁止使用「效率偏高属正常」「属正常现象」等把好成绩说成理所当然、显得在给结果打折扣的表述。`,
    '⑥ warehouseAttendance.averageCostPerTicket 是每票平均人工成本（货币单位与薪资口径一致）；若该字段有值，须在点评中作为单位成本指标提及（如「每票成本 $X.XX」），体现人效比；若为 null，跳过不提。',
    '对扫描员排名、高低值判断时，优先使用 topScanners[].adjustedEfficiency（与页面表格/图表一致）；仅当该字段缺失时，才回退到 rawEfficiency。',
    '只依据数字与字段下笔；不许编造；缺的关键信息就用一句话点出缺口。',
    '面向群里同事：只写结论与关键数字（人次、件数、效率名与数值、名次/高低），不写分母拆解、工时对照、「与…口径不同」「请勿直接对比」等说明套话。',
    '建议结构：先一句概括区间整体；再报总效率实际值 vs 目标，并结合菜鸟占比解读差距；若有每票成本则附上；最后一句一级分拣情况或风险提示。尽量不用分点或小标题，除非内容确实需要分层。',
    '禁止输出：markdown、JSON；少用空话套话。',
    '禁止使用这些词或同类表述：人工智能、AI、大模型、自动生成。',
    '禁止使用「效率偏高属正常」「属正常现象」等把良好业绩淡化为理所当然的措辞；如需解释菜鸟占比与效率的关系，用中性、正面的说法。',
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
