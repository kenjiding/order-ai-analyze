import assert from 'node:assert/strict'
import test from 'node:test'
import {
  VENDOR_ANALYSIS_DATA_SOURCES,
  VENDOR_ANALYSIS_METRICS,
  buildVendorAiSystemPrompt,
  mergeModuleMetricKeys,
  parseVendorAnalysisDataSources,
  resolveVendorAnalysisDataSources,
} from './metricsCatalog'

/** 改造前硬编码在 vendorAnalysisRouter.ts 的 prompt 原文，作为 metricKeys=null 时的回归基线 */
const LEGACY_SYSTEM_PROMPTS: Record<'zh-CN' | 'en', string> = {
  'zh-CN': `你是 iMile Australia 的资深运营分析师，负责向各快递供应商提供有深度、可执行的数据分析报告。

【指标基准线】
- 11点前出仓率：≥99% 达标，[95%,99%) 预警，<95% 异常
- 24H派签率：≥95% 达标，[92%,95%) 预警，<92% 异常
- 客诉率：≤0.025% 达标，(0.025%,0.03%) 预警，≥0.03% 异常

【分析要求】针对每家供应商输出150~250字的专业中文分析，必须涵盖以下维度：
1. 供应商整体表现总结（对照基准，指出哪些指标有问题、偏差幅度，不只是重复数字）
2. 司机层面深入分析：
   - 点名24H派签率最低的2~3名司机及其路由、具体数值
   - 点名归班预警次数最多的司机，说明风险
   - 若存在长尾单较多的司机，说明待跟进件量及潜在风险
   - 若存在某条路由多名司机均表现差，判断可能是路线问题而非个人问题
3. 问题归因推断（基于数据，不要凭空猜测）
4. 具体可执行建议（涉及到人名或路由，而非"加强管理"之类的空话）

【格式要求】
- 输出适合飞书消息卡片展示的 Markdown：用 **加粗** 标出小标题（如"整体表现""司机分析""问题归因""改进建议"）分段书写；涉及具体人名、路由、数值的逐条内容用 "- " 开头的无序列表列出，不要堆在一段话里
- 不使用一级/二级标题（#）、表格、代码块、emoji
- 150~250字，言之有物，不堆砌废话
- 若某家供应商所有指标均达标，则以积极语气简要肯定（60~80字即可），并从司机数据中找出表现最优司机予以点名
- 禁止出现：AI、大模型、自动生成、人工智能

返回严格 JSON（UTF-8，无 markdown wrapper）：{"summaries":{"<vendorCode>":"<analysis>",...}}`,
  en: `You are a senior operations analyst at iMile Australia, producing in-depth, actionable performance reports for courier vendors.

[Metric baselines]
- Exit rate by 11:00: ≥99% on target, [95%,99%) warning, <95% critical
- 24h dispatch/sign-off rate: ≥95% on target, [92%,95%) warning, <92% critical
- Complaint rate: ≤0.025% on target, (0.025%,0.03%) warning, ≥0.03% critical

[Requirements] For each vendor, write a professional English analysis of 150–250 words covering:
1. Overall vendor performance vs baselines (which metrics miss target and by how much—not just repeating numbers)
2. Courier-level analysis:
   - Name the 2–3 couriers with the lowest 24h dispatch rates, their routes, and figures
   - Name couriers with the most return alerts and explain risk
   - If couriers have high long-tail counts, note follow-up volume and risk
   - If multiple couriers on the same route underperform, consider a route issue rather than individuals
3. Root-cause inference grounded in data (no speculation)
4. Concrete, actionable recommendations (name couriers or routes—avoid vague "improve management")

[Format]
- Output clean Markdown suitable for a Feishu message card: use **bold** as section labels (e.g. "Overall Performance", "Courier Analysis", "Root Cause", "Recommendations"); list specific courier names, routes, and figures as "- " bullet items instead of burying them in a paragraph
- No #/## headings, tables, code blocks, or emoji
- 150–250 words; substantive, not filler
- If all metrics are on target, give brief positive feedback (60–80 words) and name top-performing couriers
- Do not mention: AI, LLM, auto-generated, artificial intelligence

Return strict JSON (UTF-8, no markdown wrapper): {"summaries":{"<vendorCode>":"<analysis>",...}}`,
}

test('metricKeys=null（老客户端）→ 全量 8 个源且有序', () => {
  const { dataSources, unknownKeys } = resolveVendorAnalysisDataSources(null)
  assert.deepEqual(dataSources, [...VENDOR_ANALYSIS_DATA_SOURCES].sort())
  assert.deepEqual(unknownKeys, [])
})

test('勾选司机地图 → 抓取 driverMap（出仓日 before11Date）', () => {
  const { dataSources } = resolveVendorAnalysisDataSources(['module.driverMap'])
  assert.deepEqual(dataSources, ['driverMap'])
})

test('空勾选 → 无数据源（所有指标均可自由取消，无固定项）', () => {
  const { dataSources, unknownKeys } = resolveVendorAnalysisDataSources([])
  assert.deepEqual(dataSources, [])
  assert.deepEqual(unknownKeys, [])
})

test('多指标共享同一源按并集去重', () => {
  const { dataSources } = resolveVendorAnalysisDataSources(['vendor.longTail', 'driver.longTail'])
  assert.deepEqual(dataSources, ['longTail'])
})

test('未知 key 被收集且不影响已知 key 解析', () => {
  const { dataSources, unknownKeys } = resolveVendorAnalysisDataSources(['vendor.foo', 'driver.returnWarning'])
  assert.deepEqual(unknownKeys, ['vendor.foo'])
  assert.ok(dataSources.includes('driverReturn'))
})

test('全部指标勾选 → 与 null 等价', () => {
  const allKeys = VENDOR_ANALYSIS_METRICS.map((m) => m.key)
  assert.deepEqual(resolveVendorAnalysisDataSources(allKeys).dataSources, resolveVendorAnalysisDataSources(null).dataSources)
})

test('AI prompt：metricKeys=null 输出与历史硬编码 prompt 完全一致', () => {
  assert.equal(buildVendorAiSystemPrompt('zh-CN', null), LEGACY_SYSTEM_PROMPTS['zh-CN'])
  assert.equal(buildVendorAiSystemPrompt('en', null), LEGACY_SYSTEM_PROMPTS.en)
})

test('AI prompt：取消归班预警后不再出现对应 bullet', () => {
  const keysWithoutReturnWarning = VENDOR_ANALYSIS_METRICS.filter((m) => m.key !== 'driver.returnWarning').map((m) => m.key)
  const prompt = buildVendorAiSystemPrompt('zh-CN', keysWithoutReturnWarning)
  assert.ok(!prompt.includes('归班预警'))
  assert.ok(prompt.includes('长尾单'))
  const promptEn = buildVendorAiSystemPrompt('en', keysWithoutReturnWarning)
  assert.ok(!promptEn.includes('return alerts'))
})

test('parseVendorAnalysisDataSources：增量拉取只校验并回传合法数据源，去重且有序', () => {
  const { dataSources, invalid } = parseVendorAnalysisDataSources(['unprocessed', 'unprocessed', 'longTail'])
  assert.deepEqual(dataSources, ['longTail', 'unprocessed'])
  assert.deepEqual(invalid, [])
})

test('parseVendorAnalysisDataSources：非法数据源被收集且不影响合法项解析', () => {
  const { dataSources, invalid } = parseVendorAnalysisDataSources(['unprocessed', 'foo'])
  assert.deepEqual(dataSources, ['unprocessed'])
  assert.deepEqual(invalid, ['foo'])
})

test('AI prompt：空勾选时不包含任何基准线/司机 bullet（无固定指标）', () => {
  const prompt = buildVendorAiSystemPrompt('zh-CN', [])
  assert.ok(!prompt.includes('11点前出仓率：≥99%'))
  assert.ok(!prompt.includes('24H派签率：≥95%'))
  assert.ok(!prompt.includes('客诉率：≤0.025%'))
  assert.ok(!prompt.includes('点名24H派签率最低的2~3名司机'))
})

test('AI prompt：仅勾选 24H派签率 时只出现对应基准线与司机 bullet', () => {
  const prompt = buildVendorAiSystemPrompt('zh-CN', ['vendor.dispatch24h', 'driver.dispatch24h'])
  assert.ok(prompt.includes('24H派签率：≥95%'))
  assert.ok(prompt.includes('点名24H派签率最低的2~3名司机'))
  assert.ok(!prompt.includes('11点前出仓率：≥99%'))
  assert.ok(!prompt.includes('客诉率：≤0.025%'))
})

test('mergeModuleMetricKeys：只覆盖扩展模块，供应商/司机指标保持不变', () => {
  const existing = [
    'vendor.before11ExitRate',
    'driver.todayPickup',
    'module.driverMap',
  ]
  const withoutMap = mergeModuleMetricKeys(existing, [])
  assert.deepEqual(withoutMap, ['vendor.before11ExitRate', 'driver.todayPickup'])

  const withMap = mergeModuleMetricKeys(withoutMap, ['module.driverMap', 'vendor.complaintRate'])
  assert.ok(withMap.includes('module.driverMap'))
  assert.ok(withMap.includes('vendor.before11ExitRate'))
  assert.ok(withMap.includes('driver.todayPickup'))
  // 请求里夹带的非 module key 不得新增进结果
  assert.ok(!withMap.includes('vendor.complaintRate'))
})

test('mergeModuleMetricKeys：existing=null（老任务）按全量起算后再覆盖 module', () => {
  const allKeys = VENDOR_ANALYSIS_METRICS.map((m) => m.key)
  const withoutModules = mergeModuleMetricKeys(null, [])
  assert.equal(withoutModules.length, allKeys.filter((k) => !k.startsWith('module.')).length)
  assert.ok(!withoutModules.includes('module.driverMap'))
})
