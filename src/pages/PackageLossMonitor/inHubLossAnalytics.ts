import type { AnalysisRow } from '../OrderExceptionManagement/analysisTypes'

export const IN_HUB_LOSS_SCOPE = '库内丢失'

const UNLABELED_ROUTE = '未标注路由'
const UNLABELED_SUSPECT = '未标注嫌疑派件员'
export const UNLABELED_VENDOR = '未标注供应商'
const UNLABELED_PERSON = '未标注责任人'
const SUSPECT_LABEL = '首个嫌疑派件员'
const VENDOR_LABEL = '所属供应商'
const SUSPECT_SUMMARY_RE = /首个嫌疑派件员\s*[:：]\s*([^｜|]+)/
const VENDOR_SUMMARY_RE = /供应商\s*[:：]\s*(.+)$/

export type CountDatum = {
  key: string
  count: number
  share: number
}

export type SankeyNode = {
  id: string
  key: string
  value: number
  /** 节点 hover 补充信息，目前用于嫌疑派件员对应的供应商 */
  detail?: string
}

export type SankeyLink = {
  source: string
  target: string
  value: number
  vendor: string
}

export type SankeyGraph = {
  nodes: SankeyNode[]
  links: SankeyLink[]
}

export type InHubLossFlow = {
  subtype: string
  route: string
  suspect: string
  vendor: string
  person: string
}

export type InHubLossFact = InHubLossFlow & {
  scope: string
  aging: string
  inHub: boolean
}

export const SANKEY_DIM_OPTIONS = [
  { value: 'vendor', label: '所属供应商' },
  { value: 'route', label: '路由码' },
  { value: 'suspect', label: '首个嫌疑派件员' },
  { value: 'person', label: '最新责任人' },
] as const

export type SankeyDimKey = (typeof SANKEY_DIM_OPTIONS)[number]['value']

export const DEFAULT_SANKEY_DIMS: SankeyDimKey[] = ['route', 'suspect']

export type SankeyColumn = {
  key: 'subtype' | SankeyDimKey
  title: string
}

export type InHubLossAnalytics = {
  doneCount: number
  inHubCount: number
  inHubShare: number
  scopeMix: CountDatum[]
  /** 每个异常类型下的子类型分布，占比相对该类型内部 */
  scopeSubtypeMix: Record<string, CountDatum[]>
  /** key = scopeSubtypeRouteKey(异常类型, 子类型)；占比相对该子类型内部 */
  scopeSubtypeRouteMix: Record<string, CountDatum[]>
  aging: CountDatum[]
  flows: InHubLossFlow[]
  facts: InHubLossFact[]
  insight: string | null
}

export function scopeSubtypeRouteKey(scope: string, subtype: string): string {
  return `${scope}\t${subtype}`
}

export type ScopeDrillPath = {
  scope: string | null
  subtype: string | null
}

export const EMPTY_SCOPE_DRILL: ScopeDrillPath = { scope: null, subtype: null }

export type ScopeDrillCrumb = {
  label: string
  path: ScopeDrillPath
}

export type ScopeDrillView = {
  path: ScopeDrillPath
  data: CountDatum[]
  caption: string
  ariaLabel: string
  canDrill: boolean
  crumbs: ScopeDrillCrumb[]
}

function nestedBump(root: Map<string, Map<string, number>>, outer: string, inner: string): void {
  let innerMap = root.get(outer)
  if (!innerMap) {
    innerMap = new Map()
    root.set(outer, innerMap)
  }
  bump(innerMap, inner)
}

function recordFromNested(
  root: Map<string, Map<string, number>>,
  sort?: (data: CountDatum[]) => CountDatum[],
): Record<string, CountDatum[]> {
  const out: Record<string, CountDatum[]> = {}
  for (const [key, map] of root) {
    const data = toCountData(map)
    out[key] = sort ? sort(data) : data
  }
  return out
}

export function routeCodeOf(row: AnalysisRow): string {
  const code = row.orderInfo?.consigneeRouteCode?.trim()
  return code && code !== '—' ? code : UNLABELED_ROUTE
}

export function personOf(row: AnalysisRow): string {
  const person = row.latestResponsibility?.person?.trim()
  return person && person !== '—' ? person : UNLABELED_PERSON
}

export function suspectCourierOf(row: AnalysisRow): string {
  const fromEntry = row.extraData?.entries?.find((entry) => entry.label.trim() === SUSPECT_LABEL)?.value.trim()
  if (fromEntry && fromEntry !== '—') return fromEntry
  const summary = row.extraData?.summary?.trim() ?? ''
  const matched = SUSPECT_SUMMARY_RE.exec(summary)?.[1]?.trim()
  if (matched && matched !== '—') return matched
  return UNLABELED_SUSPECT
}

export function vendorOf(row: AnalysisRow): string {
  const fromEntry = row.extraData?.entries?.find((entry) => entry.label.trim() === VENDOR_LABEL)?.value.trim()
  if (fromEntry && fromEntry !== '—') return fromEntry
  const summary = row.extraData?.summary?.trim() ?? ''
  const matched = VENDOR_SUMMARY_RE.exec(summary)?.[1]?.trim()
  if (matched && matched !== '—') return matched
  return UNLABELED_VENDOR
}

export function subtypeOf(row: AnalysisRow): string {
  const name = row.categoryName?.trim()
  return name && name !== '—' ? name : '未分类'
}

function noOperationDaysOf(row: AnalysisRow): number | null {
  const days = row.latestResponsibility?.noOperationDays
  return typeof days === 'number' && Number.isFinite(days) ? days : null
}

export function agingBucketOf(days: number | null): string {
  if (days == null) return '未知'
  if (days <= 2) return '0-2 天'
  if (days <= 7) return '3-7 天'
  if (days <= 14) return '8-14 天'
  if (days <= 30) return '15-30 天'
  return '30 天以上'
}

const AGING_ORDER = ['0-2 天', '3-7 天', '8-14 天', '15-30 天', '30 天以上', '未知']

function toCountData(map: Map<string, number>, order?: string[]): CountDatum[] {
  const total = [...map.values()].reduce((sum, n) => sum + n, 0)
  const keys = order
    ? order.filter((key) => map.has(key))
    : [...map.keys()].sort((a, b) => (map.get(b) ?? 0) - (map.get(a) ?? 0) || a.localeCompare(b, 'zh-CN'))
  return keys.map((key) => {
    const count = map.get(key) ?? 0
    return { key, count, share: total > 0 ? count / total : 0 }
  })
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by)
}

function bumpLink(map: Map<string, number>, source: string, target: string, vendor: string, by = 1): void {
  const key = `${source}\t${target}\t${vendor}`
  map.set(key, (map.get(key) ?? 0) + by)
}

function layerId(layer: 's' | 'r' | 'd' | 'v' | 'p', label: string): string {
  return `${layer}:${label}`
}

const NUMERIC_ROUTE_PREFIX = '#'

/** 路由码前缀：首字母（大小写不敏感，EE033 与 E067 同属 E）；纯数字归为一组；未标注垫底。 */
export function routeCodePrefix(code: string): string {
  const trimmed = code.trim()
  if (!trimmed || trimmed === UNLABELED_ROUTE) return ''
  if (/^[A-Za-z]/.test(trimmed)) return trimmed[0].toUpperCase()
  return NUMERIC_ROUTE_PREFIX
}

function compareCode(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function prefixGroupRank(prefix: string): number {
  if (prefix === '') return 2
  if (prefix === NUMERIC_ROUTE_PREFIX) return 1
  return 0
}

function buildRoutePrefixOrder(routeNodes: readonly { key: string; value: number }[]): Map<string, number> {
  const groups = new Map<string, { total: number; minKey: string }>()
  for (const node of routeNodes) {
    const prefix = routeCodePrefix(node.key)
    const group = groups.get(prefix)
    if (!group) {
      groups.set(prefix, { total: node.value, minKey: node.key })
      continue
    }
    group.total += node.value
    if (compareCode(node.key, group.minKey) < 0) group.minKey = node.key
  }
  return new Map(
    [...groups.entries()]
      .sort((a, b) => {
        const rankA = prefixGroupRank(a[0])
        const rankB = prefixGroupRank(b[0])
        const unlabeledA = rankA === 2
        const unlabeledB = rankB === 2
        if (unlabeledA !== unlabeledB) return unlabeledA ? 1 : -1
        if (b[1].total !== a[1].total) return b[1].total - a[1].total
        if (rankA !== rankB) return rankA - rankB
        return compareCode(a[1].minKey, b[1].minKey)
      })
      .map(([prefix], index) => [prefix, index]),
  )
}

function compareRouteCodeNodes(
  a: { key: string; value: number },
  b: { key: string; value: number },
  prefixOrder: Map<string, number>,
): number {
  const prefixA = routeCodePrefix(a.key)
  const prefixB = routeCodePrefix(b.key)
  if (prefixA !== prefixB) return (prefixOrder.get(prefixA) ?? 0) - (prefixOrder.get(prefixB) ?? 0)
  return b.value - a.value || compareCode(a.key, b.key)
}

function isUnlabeledVendor(name: string): boolean {
  return name === UNLABELED_VENDOR
}

function isUnlabeledSuspect(name: string): boolean {
  return name === UNLABELED_SUSPECT
}

function compareLabeledThenCountThenName(
  a: { key: string; value: number; unlabeled: boolean },
  b: { key: string; value: number; unlabeled: boolean },
): number {
  if (a.unlabeled !== b.unlabeled) return a.unlabeled ? 1 : -1
  return b.value - a.value || a.key.localeCompare(b.key, 'zh-CN')
}

/** 供应商列：未标注垫底，其余按单量降序。 */
function compareVendorNodes(a: { key: string; value: number }, b: { key: string; value: number }): number {
  return compareLabeledThenCountThenName(
    { key: a.key, value: a.value, unlabeled: isUnlabeledVendor(a.key) },
    { key: b.key, value: b.value, unlabeled: isUnlabeledVendor(b.key) },
  )
}

function primaryVendorOf(vendorCounts: Map<string, number> | undefined): string {
  if (!vendorCounts || vendorCounts.size === 0) return UNLABELED_VENDOR
  const entries = [...vendorCounts.entries()].sort((left, right) =>
    compareLabeledThenCountThenName(
      { key: left[0], value: left[1], unlabeled: isUnlabeledVendor(left[0]) },
      { key: right[0], value: right[1], unlabeled: isUnlabeledVendor(right[0]) },
    ),
  )
  return entries[0][0]
}

function buildVendorOrder(vendorTotals: Map<string, number>): Map<string, number> {
  return new Map(
    [...vendorTotals.entries()]
      .sort((left, right) =>
        compareVendorNodes({ key: left[0], value: left[1] }, { key: right[0], value: right[1] }),
      )
      .map(([vendor], index) => [vendor, index]),
  )
}

/** 嫌疑派件员列：按主供应商分组（与供应商列同一顺序），组内按单量；未标注派件员垫底。 */
function compareSuspectNodes(
  a: { id: string; key: string; value: number },
  b: { id: string; key: string; value: number },
  primaryVendorBySuspectId: Map<string, string>,
  vendorOrder: Map<string, number>,
): number {
  const unlabeledA = isUnlabeledSuspect(a.key)
  const unlabeledB = isUnlabeledSuspect(b.key)
  if (unlabeledA !== unlabeledB) return unlabeledA ? 1 : -1
  const vendorA = primaryVendorBySuspectId.get(a.id) ?? UNLABELED_VENDOR
  const vendorB = primaryVendorBySuspectId.get(b.id) ?? UNLABELED_VENDOR
  const orderA = vendorOrder.get(vendorA) ?? Number.MAX_SAFE_INTEGER
  const orderB = vendorOrder.get(vendorB) ?? Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) return orderA - orderB
  return b.value - a.value || a.key.localeCompare(b.key, 'zh-CN')
}

/** 路由码柱状图与桑基图同一套排序：前缀分组，组内按单量降序。 */
export function sortRouteCountData(data: CountDatum[]): CountDatum[] {
  const prefixOrder = buildRoutePrefixOrder(data.map((item) => ({ key: item.key, value: item.count })))
  return [...data].sort((a, b) =>
    compareRouteCodeNodes(
      { key: a.key, value: a.count },
      { key: b.key, value: b.count },
      prefixOrder,
    ),
  )
}

export function resolveScopeDrillView(
  analytics: InHubLossAnalytics,
  path: ScopeDrillPath,
): ScopeDrillView {
  const scope = path.scope
  const subtypes = scope ? analytics.scopeSubtypeMix[scope] : undefined
  if (!scope || !subtypes?.length) {
    return {
      path: EMPTY_SCOPE_DRILL,
      data: analytics.scopeMix,
      caption: '全部已分析单，按异常类型。点击柱形下钻到子类型',
      ariaLabel: '异常类型单量分布',
      canDrill: analytics.scopeMix.length > 0,
      crumbs: [],
    }
  }

  const subtype = path.subtype
  const routes = subtype ? analytics.scopeSubtypeRouteMix[scopeSubtypeRouteKey(scope, subtype)] : undefined
  if (!subtype || !routes?.length) {
    return {
      path: { scope, subtype: null },
      data: subtypes,
      caption: `${scope} · 按子类型。点击柱形下钻到路由码`,
      ariaLabel: `${scope}子类型单量分布`,
      canDrill: subtypes.length > 0,
      crumbs: [
        { label: '全部异常类型', path: EMPTY_SCOPE_DRILL },
        { label: scope, path: { scope, subtype: null } },
      ],
    }
  }

  return {
    path: { scope, subtype },
    data: routes,
    caption: `${scope} / ${subtype} · 按路由码`,
    ariaLabel: `${scope}${subtype}路由码单量分布`,
    canDrill: false,
    crumbs: [
      { label: '全部异常类型', path: EMPTY_SCOPE_DRILL },
      { label: scope, path: { scope, subtype: null } },
      { label: subtype, path: { scope, subtype } },
    ],
  }
}

export function nextScopeDrillPath(path: ScopeDrillPath, key: string): ScopeDrillPath {
  if (!path.scope) return { scope: key, subtype: null }
  if (!path.subtype) return { scope: path.scope, subtype: key }
  return path
}

type LayerKey = 's' | 'r' | 'd' | 'v' | 'p'

const DIM_SPEC: Record<
  SankeyColumn['key'],
  { layer: LayerKey; title: string; valueOf: (flow: InHubLossFlow) => string }
> = {
  subtype: { layer: 's', title: '子类型', valueOf: (flow) => flow.subtype },
  route: { layer: 'r', title: '路由码', valueOf: (flow) => flow.route },
  suspect: { layer: 'd', title: '首个嫌疑派件员', valueOf: (flow) => flow.suspect },
  vendor: { layer: 'v', title: '所属供应商', valueOf: (flow) => flow.vendor },
  person: { layer: 'p', title: '最新责任人', valueOf: (flow) => flow.person },
}

/** 子类型始终作为第一列；其余按固定顺序：所属供应商 → 路由码 → 首个嫌疑派件员 → 最新责任人。 */
export function resolveSankeyColumns(selected: readonly SankeyDimKey[]): SankeyColumn[] {
  const selectedSet = new Set(selected)
  return [
    { key: 'subtype', title: '子类型' },
    ...SANKEY_DIM_OPTIONS.filter((option) => selectedSet.has(option.value)).map((option) => ({
      key: option.value,
      title: option.label,
    })),
  ]
}

/** 流向表明细列与桑基图同一套勾选维度。 */
export function resolveFlowTableColumns(selected: readonly SankeyDimKey[]): SankeyColumn[] {
  return resolveSankeyColumns(selected)
}

export type FlowTableDimKey = SankeyColumn['key']

export type InHubLossFlowTableRow = {
  key: string
  count: number
  share: number
  /** 0 表示该单元格被上一行合并，不渲染 */
  spans: Partial<Record<FlowTableDimKey, number>>
  subtype?: string
  route?: string
  suspect?: string
  vendor?: string
  person?: string
}

function flowTablePrefix(parts: string[], depth: number): string {
  return parts.slice(0, depth + 1).join('\t')
}

function attachFlowTableRowSpans(rows: InHubLossFlowTableRow[], dimKeys: FlowTableDimKey[]): void {
  for (let depth = 0; depth < dimKeys.length; depth += 1) {
    const key = dimKeys[depth]
    let i = 0
    while (i < rows.length) {
      let j = i + 1
      while (j < rows.length) {
        const same = dimKeys.slice(0, depth + 1).every((dim) => (rows[i][dim] ?? '') === (rows[j][dim] ?? ''))
        if (!same) break
        j += 1
      }
      rows[i].spans[key] = j - i
      for (let k = i + 1; k < j; k += 1) rows[k].spans[key] = 0
      i = j
    }
  }
}

/** 按勾选维度聚合；未勾选的维度跳过。 */
export function buildInHubLossFlowTableRows(
  flows: InHubLossFlow[],
  selected: readonly SankeyDimKey[],
): InHubLossFlowTableRow[] {
  const columns = resolveFlowTableColumns(selected)
  const dimKeys = columns.map((column) => column.key)
  if (flows.length === 0 || dimKeys.length < 2) return []

  const counts = new Map<string, number>()
  for (const flow of flows) {
    bump(
      counts,
      dimKeys.map((key) => DIM_SPEC[key].valueOf(flow)).join('\t'),
    )
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  const prefixTotals = dimKeys.map(() => new Map<string, number>())
  for (const [key, count] of counts) {
    const parts = key.split('\t')
    for (let depth = 0; depth < dimKeys.length; depth += 1) {
      bump(prefixTotals[depth], flowTablePrefix(parts, depth), count)
    }
  }

  const rows: InHubLossFlowTableRow[] = [...counts.entries()].map(([key, count]) => {
    const parts = key.split('\t')
    const row: InHubLossFlowTableRow = {
      key,
      count,
      share: total > 0 ? count / total : 0,
      spans: {},
    }
    for (let i = 0; i < dimKeys.length; i += 1) {
      row[dimKeys[i]] = parts[i]
    }
    return row
  })

  const routeDepth = dimKeys.indexOf('route')
  const routePrefixOrder =
    routeDepth >= 0
      ? buildRoutePrefixOrder(
          [...prefixTotals[routeDepth].entries()].map(([prefix, value]) => ({
            key: prefix.split('\t')[routeDepth] ?? prefix,
            value,
          })),
        )
      : new Map<string, number>()

  rows.sort((a, b) => {
    for (let depth = 0; depth < dimKeys.length; depth += 1) {
      const dim = dimKeys[depth]
      const leftParts = dimKeys.map((dimKey) => a[dimKey] ?? '')
      const rightParts = dimKeys.map((dimKey) => b[dimKey] ?? '')
      const leftPrefix = flowTablePrefix(leftParts, depth)
      const rightPrefix = flowTablePrefix(rightParts, depth)
      if (leftPrefix === rightPrefix) continue
      const leftTotal = prefixTotals[depth].get(leftPrefix) ?? 0
      const rightTotal = prefixTotals[depth].get(rightPrefix) ?? 0
      if (dim === 'route') {
        const compared = compareRouteCodeNodes(
          { key: leftParts[depth], value: leftTotal },
          { key: rightParts[depth], value: rightTotal },
          routePrefixOrder,
        )
        if (compared !== 0) return compared
        continue
      }
      if (rightTotal !== leftTotal) return rightTotal - leftTotal
      const compared = leftParts[depth].localeCompare(rightParts[depth], 'zh-CN')
      if (compared !== 0) return compared
    }
    return 0
  })

  attachFlowTableRowSpans(rows, dimKeys)
  return rows
}

/** 只保留丢失单量达到下限的路由码及其流向；非法或 ≤1 的下限等于不过滤。 */
export function filterFlowsByMinRouteCount(flows: InHubLossFlow[], minRouteCount: number): InHubLossFlow[] {
  const kept = routesMeetingMinCount(
    flows.map((flow) => flow.route),
    minRouteCount,
  )
  if (!kept) return flows
  return flows.filter((flow) => kept.has(flow.route))
}

function resolvedMinRouteCount(minRouteCount: number): number {
  return Number.isFinite(minRouteCount) ? Math.max(0, Math.floor(minRouteCount)) : 0
}

/** null 表示下限未启用。计数按库内丢失单量。 */
function routesMeetingMinCount(routes: readonly string[], minRouteCount: number): Set<string> | null {
  const min = resolvedMinRouteCount(minRouteCount)
  if (min <= 1) return null
  const routeCounts = new Map<string, number>()
  for (const route of routes) bump(routeCounts, route)
  const kept = new Set<string>()
  for (const [route, count] of routeCounts) {
    if (count >= min) kept.add(route)
  }
  return kept
}

export function filterFactsByMinRouteCount(facts: InHubLossFact[], minRouteCount: number): InHubLossFact[] {
  const kept = routesMeetingMinCount(
    facts.filter((fact) => fact.inHub).map((fact) => fact.route),
    minRouteCount,
  )
  if (!kept) return facts
  const remaining = facts.filter((fact) => kept.has(fact.route))
  return remaining.length === facts.length ? facts : remaining
}

function normalizeRouteCode(code: string): string {
  return code.trim().toUpperCase()
}

/** 去掉指定路由码及其流向；匹配忽略大小写与首尾空格。 */
export function filterFlowsByExcludedRouteCodes(
  flows: InHubLossFlow[],
  excludedRouteCodes: readonly string[],
): InHubLossFlow[] {
  const excluded = excludedRouteSet(excludedRouteCodes)
  if (excluded.size === 0) return flows
  return flows.filter((flow) => !excluded.has(normalizeRouteCode(flow.route)))
}

function excludedRouteSet(excludedRouteCodes: readonly string[]): Set<string> {
  return new Set(excludedRouteCodes.map(normalizeRouteCode).filter(Boolean))
}

export function filterFactsByExcludedRouteCodes(
  facts: InHubLossFact[],
  excludedRouteCodes: readonly string[],
): InHubLossFact[] {
  const excluded = excludedRouteSet(excludedRouteCodes)
  if (excluded.size === 0) return facts
  return facts.filter((fact) => !excluded.has(normalizeRouteCode(fact.route)))
}

/** 按剔除路由码、丢失数量下限过滤后重算三张图。 */
export function filterChartAnalytics(
  analytics: InHubLossAnalytics,
  excludedRouteCodes: readonly string[] = [],
  minRouteCount = 0,
): InHubLossAnalytics {
  const remaining = filterFactsByMinRouteCount(
    filterFactsByExcludedRouteCodes(analytics.facts, excludedRouteCodes),
    minRouteCount,
  )
  if (remaining === analytics.facts) return analytics
  return buildAnalyticsFromFacts(remaining)
}

/** 按路由码过滤后重算判定构成、滞留天数与库内流向，供三张图共用。 */
export function filterAnalyticsByExcludedRouteCodes(
  analytics: InHubLossAnalytics,
  excludedRouteCodes: readonly string[],
): InHubLossAnalytics {
  return filterChartAnalytics(analytics, excludedRouteCodes, 0)
}

export function uniqueRouteCodes(flows: InHubLossFlow[]): string[] {
  const counts = new Map<string, number>()
  for (const flow of flows) bump(counts, flow.route)
  return sortRouteCountData(
    [...counts.entries()].map(([key, count]) => ({ key, count, share: 0 })),
  ).map((item) => item.key)
}

/** 当前流向里实际出现的子类型，按单量降序。 */
export function uniqueSubtypes(flows: InHubLossFlow[]): string[] {
  const counts = new Map<string, number>()
  for (const flow of flows) bump(counts, flow.subtype)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([key]) => key)
}

export function filterFlowsBySubtypes(flows: InHubLossFlow[], selected: readonly string[]): InHubLossFlow[] {
  if (selected.length === 0) return []
  const kept = new Set(selected)
  return flows.filter((flow) => kept.has(flow.subtype))
}

export function canonicalizeExcludedRouteCodes(
  values: readonly string[],
  knownRouteCodes: readonly string[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const matched = knownRouteCodes.find((code) => normalizeRouteCode(code) === normalizeRouteCode(trimmed))
    const canonical = matched ?? trimmed
    const id = normalizeRouteCode(canonical)
    if (seen.has(id)) continue
    seen.add(id)
    result.push(canonical)
  }
  return result
}

export function buildSankeyGraph(
  flows: InHubLossFlow[],
  selected: readonly SankeyDimKey[],
  minRouteCount = 0,
  excludedRouteCodes: readonly string[] = [],
): SankeyGraph {
  const scoped = filterFlowsByMinRouteCount(
    filterFlowsByExcludedRouteCodes(flows, excludedRouteCodes),
    minRouteCount,
  )
  const columns = resolveSankeyColumns(selected)
  if (scoped.length === 0 || columns.length < 2) return { nodes: [], links: [] }

  const nodeCounts = new Map<string, number>()
  const nodeLabels = new Map<string, string>()
  const linkCounts = new Map<string, number>()
  const suspectVendorCounts = new Map<string, Map<string, number>>()

  for (const flow of scoped) {
    const ids = columns.map((column) => {
      const spec = DIM_SPEC[column.key]
      const label = spec.valueOf(flow)
      const id = layerId(spec.layer, label)
      nodeLabels.set(id, label)
      bump(nodeCounts, id)
      return id
    })
    for (let i = 0; i < ids.length - 1; i += 1) {
      bumpLink(linkCounts, ids[i], ids[i + 1], flow.vendor)
    }
    const suspectId = layerId('d', flow.suspect)
    let vendorMap = suspectVendorCounts.get(suspectId)
    if (!vendorMap) {
      vendorMap = new Map()
      suspectVendorCounts.set(suspectId, vendorMap)
    }
    bump(vendorMap, flow.vendor)
  }

  const layerOrder = new Map(columns.map((column, index) => [DIM_SPEC[column.key].layer, index]))
  const nodes: SankeyNode[] = [...nodeLabels.entries()].map(([id, key]) => {
    const node: SankeyNode = { id, key, value: nodeCounts.get(id) ?? 0 }
    if (id.startsWith('d:')) {
      const detail = formatVendorDetail(suspectVendorCounts.get(id))
      if (detail) node.detail = detail
    }
    return node
  })
  const routePrefixOrder = buildRoutePrefixOrder(nodes.filter((node) => node.id.startsWith('r:')))
  const vendorTotals = new Map<string, number>()
  const primaryVendorBySuspectId = new Map<string, string>()
  for (const [suspectId, vendorMap] of suspectVendorCounts) {
    primaryVendorBySuspectId.set(suspectId, primaryVendorOf(vendorMap))
    for (const [vendor, count] of vendorMap) bump(vendorTotals, vendor)
  }
  const vendorOrder = buildVendorOrder(vendorTotals)
  nodes.sort((a, b) => {
    const layerA = layerOrder.get(a.id[0] as LayerKey) ?? 0
    const layerB = layerOrder.get(b.id[0] as LayerKey) ?? 0
    if (layerA !== layerB) return layerA - layerB
    if (a.id.startsWith('r:') && b.id.startsWith('r:')) return compareRouteCodeNodes(a, b, routePrefixOrder)
    if (a.id.startsWith('v:') && b.id.startsWith('v:')) return compareVendorNodes(a, b)
    if (a.id.startsWith('d:') && b.id.startsWith('d:')) {
      return compareSuspectNodes(a, b, primaryVendorBySuspectId, vendorOrder)
    }
    return b.value - a.value || a.key.localeCompare(b.key, 'zh-CN')
  })

  const links: SankeyLink[] = [...linkCounts.entries()]
    .map(([pair, value]) => {
      const [source, target, vendor] = pair.split('\t')
      return { source, target, value, vendor: vendor || UNLABELED_VENDOR }
    })
    .sort((a, b) => {
      const orderA = vendorOrder.get(a.vendor) ?? Number.MAX_SAFE_INTEGER
      const orderB = vendorOrder.get(b.vendor) ?? Number.MAX_SAFE_INTEGER
      if (orderA !== orderB) return orderA - orderB
      return b.value - a.value || a.source.localeCompare(b.source, 'zh-CN')
    })

  return { nodes, links }
}

function formatVendorDetail(vendorCounts: Map<string, number> | undefined): string | undefined {
  if (!vendorCounts || vendorCounts.size === 0) return undefined
  const entries = [...vendorCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'),
  )
  if (entries.length === 1) return entries[0][0]
  return entries.map(([name, count]) => `${name}（${count}）`).join('、')
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`
}

function buildInsight(
  inHubCount: number,
  inHubShare: number,
  subtypes: CountDatum[],
  topRoute: string | null,
  topSuspect: string | null,
  topPerson: string | null,
): string | null {
  if (inHubCount <= 0) return null
  const head = subtypes[0]
  const parts = [`库内丢失 ${inHubCount} 单，占已分析 ${pct(inHubShare)}`]
  if (head) parts.push(`${head.key} ${head.count} 单（${pct(head.share)}）`)
  if (topRoute) parts.push(`路由集中在 ${topRoute}`)
  if (topSuspect && topSuspect !== UNLABELED_SUSPECT) parts.push(`首个嫌疑派件员集中在 ${topSuspect}`)
  if (topPerson) parts.push(`责任人集中在 ${topPerson}`)
  return `${parts.join('。')}。`
}

/** 已完成分析行：库内丢失流向 + 各维度分布 */
export function buildInHubLossAnalytics(rows: AnalysisRow[]): InHubLossAnalytics {
  const facts = rows.filter((row) => row.status === 'done').map(factOf)
  return buildAnalyticsFromFacts(facts)
}

function factOf(row: AnalysisRow): InHubLossFact {
  const scope = row.lossScope?.trim() || '未分类'
  return {
    scope,
    subtype: subtypeOf(row),
    route: routeCodeOf(row),
    aging: agingBucketOf(noOperationDaysOf(row)),
    inHub: scope === IN_HUB_LOSS_SCOPE,
    suspect: suspectCourierOf(row),
    vendor: vendorOf(row),
    person: personOf(row),
  }
}

function flowOf(fact: InHubLossFact): InHubLossFlow {
  return {
    subtype: fact.subtype,
    route: fact.route,
    suspect: fact.suspect,
    vendor: fact.vendor,
    person: fact.person,
  }
}

function buildAnalyticsFromFacts(facts: InHubLossFact[]): InHubLossAnalytics {
  const inHub = facts.filter((fact) => fact.inHub)

  const scopeMap = new Map<string, number>()
  const subtypeByScope = new Map<string, Map<string, number>>()
  const routeByScopeSubtype = new Map<string, Map<string, number>>()
  for (const fact of facts) {
    bump(scopeMap, fact.scope)
    nestedBump(subtypeByScope, fact.scope, fact.subtype)
    nestedBump(routeByScopeSubtype, scopeSubtypeRouteKey(fact.scope, fact.subtype), fact.route)
  }

  const subtypeMap = new Map<string, number>()
  const routeMap = new Map<string, number>()
  const suspectMap = new Map<string, number>()
  const personMap = new Map<string, number>()
  const agingMap = new Map<string, number>()
  for (const fact of inHub) {
    bump(subtypeMap, fact.subtype)
    bump(routeMap, fact.route)
    bump(suspectMap, fact.suspect)
    bump(personMap, fact.person)
    bump(agingMap, fact.aging)
  }

  const subtypes = toCountData(subtypeMap)
  const routes = toCountData(routeMap)
  const suspects = toCountData(suspectMap)
  const persons = toCountData(personMap)
  const inHubShare = facts.length > 0 ? inHub.length / facts.length : 0

  return {
    doneCount: facts.length,
    inHubCount: inHub.length,
    inHubShare,
    scopeMix: toCountData(scopeMap),
    scopeSubtypeMix: recordFromNested(subtypeByScope),
    scopeSubtypeRouteMix: recordFromNested(routeByScopeSubtype, sortRouteCountData),
    aging: toCountData(agingMap, AGING_ORDER),
    flows: inHub.map(flowOf),
    facts,
    insight: buildInsight(
      inHub.length,
      inHubShare,
      subtypes,
      routes[0]?.key ?? null,
      suspects[0]?.key ?? null,
      persons[0]?.key ?? null,
    ),
  }
}
