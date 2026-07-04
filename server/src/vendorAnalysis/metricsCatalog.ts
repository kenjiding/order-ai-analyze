/**
 * 供应商数据分析的指标目录（后端侧唯一事实来源）。
 *
 * metricKey 是前后端共享的字符串契约（前端对应 src/pages/VendorAnalysis/metricsRegistry.ts）：
 * - 每个指标声明自己依赖的数据抓取阶段（dataSources），analyze 任务按勾选并集只跑需要的阶段；
 * - AI system prompt 的「指标基准线」「司机层面分析要求」按勾选指标从片段动态组装。
 *
 * 新增指标：在此注册 key/dataSources/prompt 片段，同时在前端 registry 注册展示元数据。
 */

export const VENDOR_ANALYSIS_DATA_SOURCES = [
  'tickets',
  'unprocessed',
  'longTail',
  'before11',
  'waybills',
  'driverWaybills',
  'driverReturn',
] as const

export type VendorAnalysisDataSource = (typeof VENDOR_ANALYSIS_DATA_SOURCES)[number]

export type VendorAiLocale = 'zh-CN' | 'en'

export type VendorAnalysisMetricDef = {
  key: string
  category: 'vendor' | 'driver'
  /** 固定指标不可取消勾选，其 dataSources 永远抓取；当前全部指标均可自由勾选，无固定项 */
  fixed: boolean
  dataSources: VendorAnalysisDataSource[]
  prompt?: {
    /** 【指标基准线】中的一行（仅供应商级指标携带） */
    baseline?: Record<VendorAiLocale, string>
    /** 【分析要求】司机层面分析的一条 bullet */
    driverBullet?: Record<VendorAiLocale, string>
  }
}

export const VENDOR_ANALYSIS_METRICS: VendorAnalysisMetricDef[] = [
  {
    key: 'vendor.before11ExitRate',
    category: 'vendor',
    fixed: false,
    dataSources: ['before11'],
    prompt: {
      baseline: {
        'zh-CN': '- 11点前出仓率：≥99% 达标，[95%,99%) 预警，<95% 异常',
        en: '- Exit rate by 11:00: ≥99% on target, [95%,99%) warning, <95% critical',
      },
    },
  },
  {
    key: 'vendor.dispatch24h',
    category: 'vendor',
    fixed: false,
    dataSources: ['driverWaybills'],
    prompt: {
      baseline: {
        'zh-CN': '- 24H派签率：≥95% 达标，[92%,95%) 预警，<92% 异常',
        en: '- 24h dispatch/sign-off rate: ≥95% on target, [92%,95%) warning, <92% critical',
      },
    },
  },
  {
    key: 'vendor.complaintRate',
    category: 'vendor',
    fixed: false,
    dataSources: ['tickets', 'waybills'],
    prompt: {
      baseline: {
        'zh-CN': '- 客诉率：≤0.025% 达标，(0.025%,0.03%) 预警，≥0.03% 异常',
        en: '- Complaint rate: ≤0.025% on target, (0.025%,0.03%) warning, ≥0.03% critical',
      },
    },
  },
  {
    key: 'vendor.unprocessedTickets',
    category: 'vendor',
    fixed: false,
    dataSources: ['unprocessed'],
  },
  {
    key: 'vendor.longTail',
    category: 'vendor',
    fixed: false,
    dataSources: ['longTail'],
  },
  {
    key: 'driver.todayPickup',
    category: 'driver',
    fixed: false,
    dataSources: ['before11'],
  },
  {
    key: 'driver.dispatch24h',
    category: 'driver',
    fixed: false,
    dataSources: ['driverWaybills'],
    prompt: {
      driverBullet: {
        'zh-CN': '   - 点名24H派签率最低的2~3名司机及其路由、具体数值',
        en: '   - Name the 2–3 couriers with the lowest 24h dispatch rates, their routes, and figures',
      },
    },
  },
  {
    key: 'driver.before11ExitRate',
    category: 'driver',
    fixed: false,
    dataSources: ['before11'],
  },
  {
    key: 'driver.returnWarning',
    category: 'driver',
    fixed: false,
    dataSources: ['driverReturn'],
    prompt: {
      driverBullet: {
        'zh-CN': '   - 点名归班预警次数最多的司机，说明风险',
        en: '   - Name couriers with the most return alerts and explain risk',
      },
    },
  },
  {
    key: 'driver.longTail',
    category: 'driver',
    fixed: false,
    dataSources: ['longTail'],
    prompt: {
      driverBullet: {
        'zh-CN': '   - 若存在长尾单较多的司机，说明待跟进件量及潜在风险',
        en: '   - If couriers have high long-tail counts, note follow-up volume and risk',
      },
    },
  },
]

const METRIC_BY_KEY = new Map(VENDOR_ANALYSIS_METRICS.map((m) => [m.key, m]))

/**
 * 解析勾选指标需要的数据抓取阶段。
 * - metricKeys 为 null（老客户端未传）→ 全量 7 个源；
 * - 固定指标（fixed: true）的源永远包含；当前所有指标均可自由勾选，无固定项；
 * - 未知 key 收集进 unknownKeys 由调用方决定如何报错。
 * 返回的 dataSources 去重且按字典序排序（幂等 key 稳定性依赖此顺序）。
 */
export function resolveVendorAnalysisDataSources(metricKeys: string[] | null): {
  dataSources: VendorAnalysisDataSource[]
  unknownKeys: string[]
} {
  if (metricKeys === null) {
    return { dataSources: [...VENDOR_ANALYSIS_DATA_SOURCES].sort(), unknownKeys: [] }
  }
  const sources = new Set<VendorAnalysisDataSource>()
  for (const metric of VENDOR_ANALYSIS_METRICS) {
    if (metric.fixed) metric.dataSources.forEach((s) => sources.add(s))
  }
  const unknownKeys: string[] = []
  for (const key of metricKeys) {
    const metric = METRIC_BY_KEY.get(key)
    if (!metric) {
      unknownKeys.push(key)
      continue
    }
    metric.dataSources.forEach((s) => sources.add(s))
  }
  return { dataSources: [...sources].sort(), unknownKeys }
}

/**
 * 校验前端直接指定的数据源列表（增量拉取场景：只请求当前缺失的数据源，跳过 metricKeys → 并集 的解析）。
 * 返回去重且按字典序排序的合法数据源，非法项收集进 invalid 由调用方决定如何报错。
 */
export function parseVendorAnalysisDataSources(raw: string[]): {
  dataSources: VendorAnalysisDataSource[]
  invalid: string[]
} {
  const valid = new Set<string>(VENDOR_ANALYSIS_DATA_SOURCES)
  const sources = new Set<VendorAnalysisDataSource>()
  const invalid: string[] = []
  for (const s of raw) {
    if (valid.has(s)) sources.add(s as VendorAnalysisDataSource)
    else invalid.push(s)
  }
  return { dataSources: [...sources].sort(), invalid }
}

/** 勾选集合 → 生效指标（固定 ∪ 勾选中的已知 key，目前无固定指标）；null → 全部 */
function resolveEnabledMetrics(metricKeys: string[] | null): VendorAnalysisMetricDef[] {
  if (metricKeys === null) return VENDOR_ANALYSIS_METRICS
  const checked = new Set(metricKeys)
  return VENDOR_ANALYSIS_METRICS.filter((m) => m.fixed || checked.has(m.key))
}

/**
 * 按勾选指标组装 AI system prompt。
 * metricKeys 为 null 时输出与历史硬编码 prompt 完全一致（回归基线，见单测）。
 */
export function buildVendorAiSystemPrompt(locale: VendorAiLocale, metricKeys: string[] | null): string {
  const enabled = resolveEnabledMetrics(metricKeys)
  const baselines = enabled
    .filter((m) => m.prompt?.baseline)
    .map((m) => m.prompt!.baseline![locale])
    .join('\n')
  const driverBullets = enabled
    .filter((m) => m.prompt?.driverBullet)
    .map((m) => m.prompt!.driverBullet![locale])
    .join('\n')

  if (locale === 'zh-CN') {
    return `你是 iMile Australia 的资深运营分析师，负责向各快递供应商提供有深度、可执行的数据分析报告。

【指标基准线】
${baselines}

【分析要求】针对每家供应商输出150~250字的专业中文分析，必须涵盖以下维度：
1. 供应商整体表现总结（对照基准，指出哪些指标有问题、偏差幅度，不只是重复数字）
2. 司机层面深入分析：
${driverBullets}
   - 若存在某条路由多名司机均表现差，判断可能是路线问题而非个人问题
3. 问题归因推断（基于数据，不要凭空猜测）
4. 具体可执行建议（涉及到人名或路由，而非"加强管理"之类的空话）

【格式要求】
- 流畅中文段落，不使用 markdown、分点符号、emoji
- 150~250字，言之有物，不堆砌废话
- 若某家供应商所有指标均达标，则以积极语气简要肯定（60~80字即可），并从司机数据中找出表现最优司机予以点名
- 禁止出现：AI、大模型、自动生成、人工智能

返回严格 JSON（UTF-8，无 markdown wrapper）：{"summaries":{"<vendorCode>":"<analysis>",...}}`
  }
  return `You are a senior operations analyst at iMile Australia, producing in-depth, actionable performance reports for courier vendors.

[Metric baselines]
${baselines}

[Requirements] For each vendor, write a professional English analysis of 150–250 words covering:
1. Overall vendor performance vs baselines (which metrics miss target and by how much—not just repeating numbers)
2. Courier-level analysis:
${driverBullets}
   - If multiple couriers on the same route underperform, consider a route issue rather than individuals
3. Root-cause inference grounded in data (no speculation)
4. Concrete, actionable recommendations (name couriers or routes—avoid vague "improve management")

[Format]
- Fluent English paragraphs only; no markdown, bullet lists, or emoji
- 150–250 words; substantive, not filler
- If all metrics are on target, give brief positive feedback (60–80 words) and name top-performing couriers
- Do not mention: AI, LLM, auto-generated, artificial intelligence

Return strict JSON (UTF-8, no markdown wrapper): {"summaries":{"<vendorCode>":"<analysis>",...}}`
}
