import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AnalysisRow } from '../OrderExceptionManagement/analysisTypes'
import type { LatestResponsibility, OrderQueryInfo } from '../OrderExceptionManagement/orderExceptionApi'
import {
  buildInHubLossAnalytics,
  buildSankeyGraph,
  canonicalizeExcludedRouteCodes,
  DEFAULT_SANKEY_DIMS,
  SANKEY_DIM_OPTIONS,
  EMPTY_SCOPE_DRILL,
  EMPTY_VENDOR_DRILL,
  buildInHubLossFlowTableRows,
  filterAnalyticsByExcludedRouteCodes,
  filterChartAnalytics,
  nextScopeDrillPath,
  nextVendorDrillPath,
  resolveScopeDrillView,
  resolveVendorDrillView,
  vendorDisplayName,
  scopeSubtypeRouteKey,
  uniqueRouteCodes,
  uniqueSubtypes,
  filterFlowsBySubtypes,
  type SankeyDimKey,
} from './inHubLossAnalytics'

function orderInfo(consigneeRouteCode: string): OrderQueryInfo {
  return {
    merchantName: '',
    merchantCode: '',
    totalWeight: '',
    customerDeclaredValueAud: '',
    declaredValueUsd: '',
    consigneeRouteCode,
  }
}

function row(partial: Partial<AnalysisRow> & Pick<AnalysisRow, 'orderNo'>): AnalysisRow {
  return {
    lossScope: '库内丢失',
    categoryName: '扫描员丢失',
    currentResponsibilityParty: '仓库',
    reason: '',
    confidence: '高',
    trackEvents: [],
    interceptLogs: [],
    status: 'done',
    ...partial,
  }
}

function responsibility(person: string, noOperationDays: number): LatestResponsibility {
  return {
    source: 'track',
    owner: 'in_warehouse',
    time: '2026-08-01 10:00:00',
    displayTime: '2026-08-01 10:00:00',
    person,
    action: '入库扫描',
    noOperationDays,
  }
}

const ALL_SANKEY_DIMS: SankeyDimKey[] = ['vendor', 'route', 'suspect', 'person']

function graphOf(
  analytics: ReturnType<typeof buildInHubLossAnalytics>,
  dims: readonly SankeyDimKey[] = ALL_SANKEY_DIMS,
  minRouteCount = 0,
  excludedRouteCodes: readonly string[] = [],
) {
  return buildSankeyGraph(analytics.flows, dims, minRouteCount, excludedRouteCodes)
}

function linkOf(
  analytics: ReturnType<typeof buildInHubLossAnalytics>,
  source: string,
  target: string,
  dims: readonly SankeyDimKey[] = ALL_SANKEY_DIMS,
  minRouteCount = 0,
  excludedRouteCodes: readonly string[] = [],
) {
  return graphOf(analytics, dims, minRouteCount, excludedRouteCodes).links.find(
    (link) => link.source === source && link.target === target,
  )
}

function nodeOf(
  analytics: ReturnType<typeof buildInHubLossAnalytics>,
  id: string,
  dims: readonly SankeyDimKey[] = ALL_SANKEY_DIMS,
) {
  return graphOf(analytics, dims).nodes.find((node) => node.id === id)
}

test('DEFAULT_SANKEY_DIMS 默认勾选路由码与首个嫌疑派件员', () => {
  assert.deepEqual(
    SANKEY_DIM_OPTIONS.map((option) => option.value),
    ['vendor', 'route', 'suspect', 'person'],
  )
  assert.deepEqual(DEFAULT_SANKEY_DIMS, ['route', 'suspect'])
})

test('buildInHubLossAnalytics 忽略未完成行，并统计库内丢失流向', () => {
  const analytics = buildInHubLossAnalytics([
    row({ orderNo: '1', status: 'pending' }),
    row({ orderNo: '2', status: 'error', lossScope: '库内丢失' }),
    row({
      orderNo: '3',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('R1'),
      latestResponsibility: responsibility('张三', 4),
    }),
    row({
      orderNo: '4',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('R1'),
      latestResponsibility: responsibility('张三', 4),
    }),
    row({
      orderNo: '5',
      lossScope: '库外丢失',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('R9'),
      latestResponsibility: responsibility('李四', 1),
    }),
  ])

  assert.equal(analytics.doneCount, 3)
  assert.equal(analytics.inHubCount, 2)
  assert.equal(analytics.inHubShare, 2 / 3)
  assert.deepEqual(
    analytics.scopeMix.map((item) => item.key),
    ['库内丢失', '库外丢失'],
  )
  assert.deepEqual(analytics.scopeSubtypeMix['库内丢失'], [
    { key: '扫描员丢失', count: 2, share: 1 },
  ])
  assert.deepEqual(analytics.scopeSubtypeMix['库外丢失'], [
    { key: '疑似派件员窃取', count: 1, share: 1 },
  ])
  assert.deepEqual(analytics.scopeSubtypeRouteMix[scopeSubtypeRouteKey('库内丢失', '扫描员丢失')], [
    { key: 'R1', count: 2, share: 1 },
  ])
  assert.deepEqual(linkOf(analytics, 's:扫描员丢失', 'v:未标注供应商'), {
    source: 's:扫描员丢失',
    target: 'v:未标注供应商',
    value: 2,
    vendor: '未标注供应商',
  })
  assert.deepEqual(linkOf(analytics, 'v:未标注供应商', 'r:R1'), {
    source: 'v:未标注供应商',
    target: 'r:R1',
    value: 2,
    vendor: '未标注供应商',
  })
  assert.deepEqual(linkOf(analytics, 'r:R1', 'd:未标注嫌疑派件员'), {
    source: 'r:R1',
    target: 'd:未标注嫌疑派件员',
    value: 2,
    vendor: '未标注供应商',
  })
  assert.deepEqual(linkOf(analytics, 'd:未标注嫌疑派件员', 'p:张三'), {
    source: 'd:未标注嫌疑派件员',
    target: 'p:张三',
    value: 2,
    vendor: '未标注供应商',
  })
  assert.equal(nodeOf(analytics, 'd:未标注嫌疑派件员')?.detail, '未标注供应商')
  assert.ok(analytics.insight?.includes('库内丢失 2 单'))
  assert.ok(analytics.insight?.includes('扫描员丢失 2 单'))
  assert.ok(analytics.insight?.includes('路由集中在 R1'))
  assert.ok(analytics.insight?.includes('责任人集中在 张三'))
})

test('buildInHubLossAnalytics 保留全部真实路由码，不归入其他', () => {
  const rows = Array.from({ length: 9 }, (_, i) =>
    row({
      orderNo: `n${i}`,
      orderInfo: orderInfo(`R${i}`),
      latestResponsibility: responsibility(`P${i}`, 1),
    }),
  )
  const analytics = buildInHubLossAnalytics(rows)
  const graph = graphOf(analytics)
  const routeIds = graph.nodes.filter((node) => node.id.startsWith('r:')).map((node) => node.id)
  const personIds = graph.nodes.filter((node) => node.id.startsWith('p:')).map((node) => node.id)

  assert.equal(routeIds.includes('r:其他路由'), false)
  assert.equal(personIds.includes('p:其他责任人'), false)
  assert.equal(routeIds.length, 9)
  assert.equal(personIds.length, 9)
  assert.ok(linkOf(analytics, 'v:未标注供应商', 'r:R0'))
  assert.ok(linkOf(analytics, 'v:未标注供应商', 'r:R8'))
})

test('buildInHubLossAnalytics 同名路由与责任人使用不同节点', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'same-name',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('张三'),
      latestResponsibility: responsibility('张三', 20),
    }),
  ])
  const graph = graphOf(analytics)
  assert.ok(graph.nodes.some((node) => node.id === 'r:张三' && node.key === '张三'))
  assert.ok(graph.nodes.some((node) => node.id === 'p:张三' && node.key === '张三'))
  assert.deepEqual(linkOf(analytics, 's:疑似派件员窃取', 'v:未标注供应商')?.value, 1)
  assert.deepEqual(linkOf(analytics, 'v:未标注供应商', 'r:张三')?.value, 1)
  assert.deepEqual(linkOf(analytics, 'r:张三', 'd:未标注嫌疑派件员')?.value, 1)
  assert.deepEqual(linkOf(analytics, 'd:未标注嫌疑派件员', 'p:张三')?.value, 1)
})

test('buildInHubLossAnalytics 未标注路由与未标注责任人使用不同节点', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'blank',
      categoryName: '—',
      orderInfo: orderInfo('—'),
    }),
  ])
  const keys = graphOf(analytics)
    .nodes.map((node) => `${node.id}|${node.key}`)
    .sort()
  assert.deepEqual(keys, [
    'd:未标注嫌疑派件员|未标注嫌疑派件员',
    'p:未标注责任人|未标注责任人',
    'r:未标注路由|未标注路由',
    's:未分类|未分类',
    'v:未标注供应商|未标注供应商',
  ])
})

test('buildInHubLossAnalytics 从额外数据提取首个嫌疑派件员', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'entry',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('R1'),
      extraData: {
        summary: '首个嫌疑派件员：ADL-KAS-Parth｜供应商：V1',
        entries: [
          { label: '首个嫌疑派件员', value: 'ADL-KAS-Parth' },
          { label: '所属供应商', value: 'V1' },
        ],
      },
      latestResponsibility: responsibility('仓管A', 5),
    }),
    row({
      orderNo: 'summary-only',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('R1'),
      extraData: {
        summary: '首个嫌疑派件员：ADL-KAS-Parth｜供应商：V1',
        entries: [],
      },
      latestResponsibility: responsibility('仓管A', 5),
    }),
  ])
  assert.deepEqual(linkOf(analytics, 's:疑似派件员窃取', 'v:V1'), {
    source: 's:疑似派件员窃取',
    target: 'v:V1',
    value: 2,
    vendor: 'V1',
  })
  assert.deepEqual(linkOf(analytics, 'v:V1', 'r:R1'), {
    source: 'v:V1',
    target: 'r:R1',
    value: 2,
    vendor: 'V1',
  })
  assert.deepEqual(linkOf(analytics, 'r:R1', 'd:ADL-KAS-Parth'), {
    source: 'r:R1',
    target: 'd:ADL-KAS-Parth',
    value: 2,
    vendor: 'V1',
  })
  assert.deepEqual(linkOf(analytics, 'd:ADL-KAS-Parth', 'p:仓管A'), {
    source: 'd:ADL-KAS-Parth',
    target: 'p:仓管A',
    value: 2,
    vendor: 'V1',
  })
  assert.equal(nodeOf(analytics, 'd:ADL-KAS-Parth')?.detail, 'V1')
  assert.ok(analytics.insight?.includes('首个嫌疑派件员集中在 ADL-KAS-Parth'))
})

test('buildSankeyGraph 嫌疑派件员节点 hover 汇总多名供应商', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'v1a',
      extraData: {
        summary: '首个嫌疑派件员：张派｜供应商：甲供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '张派' },
          { label: '所属供应商', value: '甲供应商' },
        ],
      },
    }),
    row({
      orderNo: 'v1b',
      extraData: {
        summary: '首个嫌疑派件员：张派｜供应商：甲供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '张派' },
          { label: '所属供应商', value: '甲供应商' },
        ],
      },
    }),
    row({
      orderNo: 'v2',
      extraData: {
        summary: '首个嫌疑派件员：张派｜供应商：乙供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '张派' },
          { label: '所属供应商', value: '乙供应商' },
        ],
      },
    }),
  ])
  assert.equal(nodeOf(analytics, 'd:张派')?.detail, '甲供应商（2）、乙供应商（1）')
  const toSuspect = graphOf(analytics)
    .links.filter((link) => link.target === 'd:张派')
    .map((link) => ({ vendor: link.vendor, value: link.value }))
    .sort((a, b) => a.vendor.localeCompare(b.vendor, 'zh-CN'))
  assert.deepEqual(toSuspect, [
    { vendor: '甲供应商', value: 2 },
    { vendor: '乙供应商', value: 1 },
  ])
})

test('buildSankeyGraph 嫌疑派件员按供应商分组，未标注垫底', () => {
  function extra(suspect: string, vendor: string) {
    return {
      summary: `首个嫌疑派件员：${suspect}｜供应商：${vendor}`,
      entries: [
        { label: '首个嫌疑派件员', value: suspect },
        { label: '所属供应商', value: vendor },
      ],
    }
  }

  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'jia-1',
      extraData: extra('张派', '甲供应商'),
    }),
    row({
      orderNo: 'jia-2',
      extraData: extra('张派', '甲供应商'),
    }),
    row({
      orderNo: 'jia-3',
      extraData: extra('王派', '甲供应商'),
    }),
    row({
      orderNo: 'yi-1',
      extraData: extra('李派', '乙供应商'),
    }),
    row({
      orderNo: 'blank-1',
    }),
    row({
      orderNo: 'blank-2',
    }),
    row({
      orderNo: 'blank-3',
    }),
  ])

  const suspectKeys = graphOf(analytics, ['suspect'])
    .nodes.filter((node) => node.id.startsWith('d:'))
    .map((node) => node.key)
  assert.deepEqual(suspectKeys, ['张派', '王派', '李派', '未标注嫌疑派件员'])

  const vendorKeys = graphOf(analytics, ['vendor'])
    .nodes.filter((node) => node.id.startsWith('v:'))
    .map((node) => node.key)
  assert.deepEqual(vendorKeys, ['甲供应商', '乙供应商', '未标注供应商'])
})

test('buildSankeyGraph 只展示选中的维度，并按单量降序排列列内节点', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'a1',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('R-HOT'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'a2',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('R-HOT'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'b1',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('R-LOW'),
      latestResponsibility: responsibility('仓管B', 1),
    }),
  ])

  const personOnly = graphOf(analytics, ['person'])
  assert.equal(
    personOnly.links.some(
      (link) => link.source.startsWith('r:') || link.source.startsWith('d:') || link.source.startsWith('v:'),
    ),
    false,
  )
  assert.deepEqual(linkOf(analytics, 's:扫描员丢失', 'p:仓管A', ['person']), {
    source: 's:扫描员丢失',
    target: 'p:仓管A',
    value: 2,
    vendor: '未标注供应商',
  })

  const routeNodes = graphOf(analytics, ['route']).nodes.filter((node) => node.id.startsWith('r:'))
  assert.deepEqual(
    routeNodes.map((node) => node.key),
    ['R-HOT', 'R-LOW'],
  )
  assert.deepEqual(
    routeNodes.map((node) => node.value),
    [2, 1],
  )

  assert.deepEqual(linkOf(analytics, 's:扫描员丢失', 'v:未标注供应商', ['vendor']), {
    source: 's:扫描员丢失',
    target: 'v:未标注供应商',
    value: 2,
    vendor: '未标注供应商',
  })
})

test('buildSankeyGraph 路由码先按前缀分组，组内再按单量降序', () => {
  const counts: Array<[string, number]> = [
    ['EE033', 3],
    ['EE045', 2],
    ['Tjj00', 1],
    ['gs909', 2],
    ['879', 2],
    ['E067', 1],
    ['f989', 1],
  ]
  const rows = counts.flatMap(([code, count]) =>
    Array.from({ length: count }, (_, index) =>
      row({
        orderNo: `${code}-${index}`,
        orderInfo: orderInfo(code),
        latestResponsibility: responsibility('仓管A', 1),
      }),
    ),
  )
  const analytics = buildInHubLossAnalytics(rows)
  const routeKeys = graphOf(analytics, ['route'])
    .nodes.filter((node) => node.id.startsWith('r:'))
    .map((node) => node.key)

  assert.deepEqual(routeKeys, ['EE033', 'EE045', 'E067', 'gs909', '879', 'Tjj00', 'f989'])
})

test('buildSankeyGraph 未标注路由排在真实路由码之后', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'blank-1',
      orderInfo: orderInfo('—'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'blank-2',
      orderInfo: orderInfo('—'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'e1',
      orderInfo: orderInfo('E067'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
  ])
  const routeKeys = graphOf(analytics, ['route'])
    .nodes.filter((node) => node.id.startsWith('r:'))
    .map((node) => node.key)

  assert.deepEqual(routeKeys, ['E067', '未标注路由'])
})

test('buildSankeyGraph 只保留丢失单量达到下限的路由码', () => {
  const counts: Array<[string, number]> = [
    ['EE033', 3],
    ['EE045', 2],
    ['Tjj00', 1],
    ['gs909', 2],
  ]
  const rows = counts.flatMap(([code, count]) =>
    Array.from({ length: count }, (_, index) =>
      row({
        orderNo: `${code}-${index}`,
        orderInfo: orderInfo(code),
        latestResponsibility: responsibility('仓管A', 1),
      }),
    ),
  )
  const analytics = buildInHubLossAnalytics(rows)
  const routeKeys = graphOf(analytics, ['route'], 2)
    .nodes.filter((node) => node.id.startsWith('r:'))
    .map((node) => node.key)

  assert.deepEqual(routeKeys, ['EE033', 'EE045', 'gs909'])
  assert.equal(linkOf(analytics, 's:扫描员丢失', 'r:Tjj00', ['route'], 2), undefined)
  assert.deepEqual(linkOf(analytics, 's:扫描员丢失', 'r:EE033', ['route'], 2), {
    source: 's:扫描员丢失',
    target: 'r:EE033',
    value: 3,
    vendor: '未标注供应商',
  })
  assert.equal(graphOf(analytics, ['route'], 4).links.length, 0)
})

test('buildSankeyGraph 排除指定路由码后不再展示，大小写不敏感', () => {
  const counts: Array<[string, number]> = [
    ['EE033', 3],
    ['EE045', 2],
    ['Tjj00', 1],
    ['gs909', 2],
  ]
  const rows = counts.flatMap(([code, count]) =>
    Array.from({ length: count }, (_, index) =>
      row({
        orderNo: `${code}-${index}`,
        orderInfo: orderInfo(code),
        latestResponsibility: responsibility('仓管A', 1),
      }),
    ),
  )
  const analytics = buildInHubLossAnalytics(rows)
  const routeKeys = graphOf(analytics, ['route'], 0, ['ee033', 'GS909'])
    .nodes.filter((node) => node.id.startsWith('r:'))
    .map((node) => node.key)

  assert.deepEqual(routeKeys, ['EE045', 'Tjj00'])
  assert.equal(linkOf(analytics, 's:扫描员丢失', 'r:EE033', ['route'], 0, ['ee033']), undefined)
  assert.deepEqual(linkOf(analytics, 's:扫描员丢失', 'r:EE045', ['route'], 0, ['ee033']), {
    source: 's:扫描员丢失',
    target: 'r:EE045',
    value: 2,
    vendor: '未标注供应商',
  })
  assert.deepEqual(uniqueRouteCodes(analytics.flows), ['EE033', 'EE045', 'gs909', 'Tjj00'])
  assert.deepEqual(canonicalizeExcludedRouteCodes(['ee033', ' EE033 ', 'xx'], uniqueRouteCodes(analytics.flows)), [
    'EE033',
    'xx',
  ])
})

test('filterFlowsBySubtypes 只保留勾选的子类型，桑基图不再出现未勾选节点', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'scan-1',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'scan-2',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'steal-1',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('Tjj00'),
      latestResponsibility: responsibility('仓管B', 1),
    }),
    row({
      orderNo: 'keeper-1',
      categoryName: '仓管丢失',
      orderInfo: orderInfo('gs909'),
      latestResponsibility: responsibility('仓管C', 1),
    }),
  ])

  assert.deepEqual(uniqueSubtypes(analytics.flows), ['扫描员丢失', '仓管丢失', '疑似派件员窃取'])
  assert.deepEqual(filterFlowsBySubtypes(analytics.flows, []), [])

  const filtered = filterFlowsBySubtypes(analytics.flows, ['疑似派件员窃取', '仓管丢失'])
  assert.equal(filtered.length, 2)
  assert.deepEqual(
    [...new Set(filtered.map((flow) => flow.subtype))].sort(),
    ['仓管丢失', '疑似派件员窃取'],
  )

  const graph = buildSankeyGraph(filtered, ['route'])
  assert.equal(
    graph.nodes.some((node) => node.id === 's:扫描员丢失'),
    false,
  )
  assert.equal(
    graph.nodes.some((node) => node.id === 's:疑似派件员窃取'),
    true,
  )
  assert.equal(
    graph.nodes.some((node) => node.id === 's:仓管丢失'),
    true,
  )
  assert.equal(graph.nodes.some((node) => node.id === 'r:EE033'), false)
})

test('filterAnalyticsByExcludedRouteCodes 同步过滤判定构成与库内流向', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'in-1',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('张三', 4),
    }),
    row({
      orderNo: 'in-2',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('张三', 4),
    }),
    row({
      orderNo: 'in-3',
      categoryName: '仓管丢失',
      orderInfo: orderInfo('Tjj00'),
      latestResponsibility: responsibility('李四', 1),
    }),
    row({
      orderNo: 'out-1',
      lossScope: '库外丢失',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('王五', 10),
    }),
  ])

  const filtered = filterAnalyticsByExcludedRouteCodes(analytics, ['ee033'])
  assert.equal(filtered.scopeMix[0]?.key, '库内丢失')
  assert.equal(filtered.scopeMix[0]?.count, 1)
  assert.equal(filtered.scopeMix[0]?.share, 1)
  assert.equal(filtered.scopeMix.length, 1)
  assert.equal(filtered.scopeSubtypeMix['库外丢失'], undefined)
  assert.deepEqual(filtered.scopeSubtypeMix['库内丢失']?.map((item) => item.key), ['仓管丢失'])
  assert.deepEqual(
    filtered.scopeSubtypeRouteMix[scopeSubtypeRouteKey('库内丢失', '仓管丢失')]?.map((item) => item.key),
    ['Tjj00'],
  )
  assert.equal(filtered.flows.every((flow) => flow.route !== 'EE033'), true)
  assert.equal(filtered.inHubCount, 1)
  assert.equal(filtered.doneCount, 1)

  const drill = resolveScopeDrillView(filtered, { scope: '库内丢失', subtype: '扫描员丢失' })
  assert.equal(drill.path.subtype, null)
  assert.deepEqual(
    drill.data.map((item) => item.key),
    ['仓管丢失'],
  )
})

test('filterChartAnalytics 按路由码丢失数量下限同步过滤判定构成与库内流向', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'in-1',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('张三', 4),
    }),
    row({
      orderNo: 'in-2',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      latestResponsibility: responsibility('张三', 4),
    }),
    row({
      orderNo: 'in-3',
      categoryName: '仓管丢失',
      orderInfo: orderInfo('Tjj00'),
      latestResponsibility: responsibility('李四', 1),
    }),
    row({
      orderNo: 'out-1',
      lossScope: '库外丢失',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('Tjj00'),
      latestResponsibility: responsibility('王五', 10),
    }),
  ])

  const filtered = filterChartAnalytics(analytics, [], 2)
  assert.equal(filtered.scopeMix.length, 1)
  assert.equal(filtered.scopeMix[0]?.key, '库内丢失')
  assert.equal(filtered.scopeMix[0]?.count, 2)
  assert.equal(filtered.scopeSubtypeMix['库外丢失'], undefined)
  assert.deepEqual(filtered.scopeSubtypeMix['库内丢失']?.map((item) => item.key), ['扫描员丢失'])
  assert.deepEqual(
    filtered.scopeSubtypeRouteMix[scopeSubtypeRouteKey('库内丢失', '扫描员丢失')]?.map((item) => item.key),
    ['EE033'],
  )
  assert.equal(filtered.flows.every((flow) => flow.route === 'EE033'), true)
  assert.equal(filtered.inHubCount, 2)
  assert.equal(filtered.doneCount, 2)

  const unfiltered = filterChartAnalytics(analytics, [], 1)
  assert.equal(unfiltered, analytics)
})

test('判定构成下钻：异常类型 → 子类型 → 路由码，占比相对当前层', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'a1',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
    }),
    row({
      orderNo: 'a2',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
    }),
    row({
      orderNo: 'a3',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('Tjj00'),
    }),
    row({
      orderNo: 'b1',
      categoryName: '仓管丢失',
      orderInfo: orderInfo('gs909'),
    }),
    row({
      orderNo: 'c1',
      lossScope: '库外丢失',
      categoryName: '疑似派件员窃取',
      orderInfo: orderInfo('R9'),
    }),
  ])

  const inHubSubtypes = analytics.scopeSubtypeMix['库内丢失']
  assert.deepEqual(
    inHubSubtypes.map((item) => item.key),
    ['扫描员丢失', '仓管丢失'],
  )
  assert.equal(inHubSubtypes[0]?.count, 3)
  assert.equal(inHubSubtypes[0]?.share, 0.75)
  assert.equal(inHubSubtypes[1]?.count, 1)
  assert.equal(inHubSubtypes[1]?.share, 0.25)

  const scanRoutes = analytics.scopeSubtypeRouteMix[scopeSubtypeRouteKey('库内丢失', '扫描员丢失')]
  assert.deepEqual(
    scanRoutes.map((item) => item.key),
    ['EE033', 'Tjj00'],
  )
  assert.equal(scanRoutes[0]?.count, 2)
  assert.equal(scanRoutes[0]?.share, 2 / 3)

  const top = resolveScopeDrillView(analytics, EMPTY_SCOPE_DRILL)
  assert.equal(top.canDrill, true)
  assert.deepEqual(
    top.data.map((item) => item.key),
    ['库内丢失', '库外丢失'],
  )

  const subtypeView = resolveScopeDrillView(analytics, nextScopeDrillPath(top.path, '库内丢失'))
  assert.equal(subtypeView.path.scope, '库内丢失')
  assert.equal(subtypeView.path.subtype, null)
  assert.equal(subtypeView.canDrill, true)
  assert.deepEqual(
    subtypeView.data.map((item) => item.key),
    ['扫描员丢失', '仓管丢失'],
  )

  const routeView = resolveScopeDrillView(analytics, nextScopeDrillPath(subtypeView.path, '扫描员丢失'))
  assert.equal(routeView.path.subtype, '扫描员丢失')
  assert.equal(routeView.canDrill, false)
  assert.deepEqual(
    routeView.data.map((item) => item.key),
    ['EE033', 'Tjj00'],
  )
  assert.deepEqual(
    routeView.crumbs.map((crumb) => crumb.label),
    ['全部异常类型', '库内丢失', '扫描员丢失'],
  )
})

test('buildInHubLossFlowTableRows 按子类型、供应商、路由码、嫌疑派件员、责任人顺序聚合', () => {
  const analytics = buildInHubLossAnalytics([
    row({
      orderNo: 'a1',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      extraData: {
        summary: '首个嫌疑派件员：张派｜供应商：甲供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '张派' },
          { label: '所属供应商', value: '甲供应商' },
        ],
      },
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'a2',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      extraData: {
        summary: '首个嫌疑派件员：张派｜供应商：甲供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '张派' },
          { label: '所属供应商', value: '甲供应商' },
        ],
      },
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'a3',
      categoryName: '扫描员丢失',
      orderInfo: orderInfo('EE033'),
      extraData: {
        summary: '首个嫌疑派件员：李派｜供应商：乙供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '李派' },
          { label: '所属供应商', value: '乙供应商' },
        ],
      },
      latestResponsibility: responsibility('仓管A', 1),
    }),
    row({
      orderNo: 'b1',
      categoryName: '仓管丢失',
      orderInfo: orderInfo('Tjj00'),
      extraData: {
        summary: '首个嫌疑派件员：李派｜供应商：乙供应商',
        entries: [
          { label: '首个嫌疑派件员', value: '李派' },
          { label: '所属供应商', value: '乙供应商' },
        ],
      },
      latestResponsibility: responsibility('仓管B', 1),
    }),
  ])

  const defaultRows = buildInHubLossFlowTableRows(analytics.flows, DEFAULT_SANKEY_DIMS)
  assert.deepEqual(
    defaultRows.map((row) => ({
      subtype: row.subtype,
      route: row.route,
      suspect: row.suspect,
      count: row.count,
      subtypeSpan: row.spans.subtype,
      routeSpan: row.spans.route,
      suspectSpan: row.spans.suspect,
    })),
    [
      {
        subtype: '扫描员丢失',
        route: 'EE033',
        suspect: '张派',
        count: 2,
        subtypeSpan: 2,
        routeSpan: 2,
        suspectSpan: 1,
      },
      {
        subtype: '扫描员丢失',
        route: 'EE033',
        suspect: '李派',
        count: 1,
        subtypeSpan: 0,
        routeSpan: 0,
        suspectSpan: 1,
      },
      {
        subtype: '仓管丢失',
        route: 'Tjj00',
        suspect: '李派',
        count: 1,
        subtypeSpan: 1,
        routeSpan: 1,
        suspectSpan: 1,
      },
    ],
  )
  assert.equal(defaultRows[0]?.vendor, undefined)

  const extended = buildInHubLossFlowTableRows(analytics.flows, ['vendor', 'route', 'suspect', 'person'])
  assert.equal(extended[0]?.subtype, '扫描员丢失')
  assert.equal(extended[0]?.vendor, '甲供应商')
  assert.equal(extended[0]?.route, 'EE033')
  assert.equal(extended[0]?.person, '仓管A')
  assert.equal(extended[0]?.spans.subtype, 2)
  assert.equal(extended[0]?.spans.vendor, 1)
  assert.deepEqual(buildInHubLossFlowTableRows(analytics.flows, []), [])
})


test('供应商下钻：供应商 → 路由码 → 司机，仅统计库内丢失', () => {
  function extra(suspect: string, vendor: string) {
    return {
      summary: `首个嫌疑派件员：${suspect}｜供应商：${vendor}`,
      entries: [
        { label: '首个嫌疑派件员', value: suspect },
        { label: '所属供应商', value: vendor },
      ],
    }
  }

  const analytics = buildInHubLossAnalytics([
    row({ orderNo: 'a1', orderInfo: orderInfo('EE033'), extraData: extra('张派', '甲供应商') }),
    row({ orderNo: 'a2', orderInfo: orderInfo('EE033'), extraData: extra('张派', '甲供应商') }),
    row({ orderNo: 'a3', orderInfo: orderInfo('EE033'), extraData: extra('王派', '甲供应商') }),
    row({ orderNo: 'a4', orderInfo: orderInfo('Tjj00'), extraData: extra('王派', '甲供应商') }),
    row({ orderNo: 'b1', orderInfo: orderInfo('R9'), extraData: extra('李派', '乙供应商') }),
    row({
      orderNo: 'out1',
      lossScope: '库外丢失',
      orderInfo: orderInfo('EE033'),
      extraData: extra('张派', '甲供应商'),
    }),
  ])

  assert.deepEqual(
    analytics.vendorMix.map((item) => [item.key, item.count]),
    [
      ['甲供应商', 4],
      ['乙供应商', 1],
    ],
  )

  const top = resolveVendorDrillView(analytics, EMPTY_VENDOR_DRILL)
  assert.equal(top.canDrill, true)
  assert.deepEqual(top.crumbs, [])

  const routeView = resolveVendorDrillView(analytics, nextVendorDrillPath(top.path, '甲供应商'))
  assert.equal(routeView.path.vendor, '甲供应商')
  assert.equal(routeView.path.route, null)
  assert.equal(routeView.canDrill, true)
  assert.deepEqual(
    routeView.data.map((item) => [item.key, item.count]),
    [
      ['EE033', 3],
      ['Tjj00', 1],
    ],
  )
  assert.equal(routeView.data[0]?.share, 0.75)

  const suspectView = resolveVendorDrillView(analytics, nextVendorDrillPath(routeView.path, 'EE033'))
  assert.equal(suspectView.canDrill, false)
  assert.deepEqual(
    suspectView.data.map((item) => [item.key, item.count]),
    [
      ['张派', 2],
      ['王派', 1],
    ],
  )
  assert.deepEqual(
    suspectView.crumbs.map((crumb) => crumb.label),
    ['全部供应商', '甲供应商', 'EE033'],
  )

  // 路由码不存在于该供应商下时回退到根视图
  assert.deepEqual(resolveVendorDrillView(analytics, { vendor: '甲供应商', route: 'R9' }).data, routeView.data)
  assert.deepEqual(resolveVendorDrillView(analytics, { vendor: '丙供应商', route: null }).data, analytics.vendorMix)
})

test('vendorDisplayName 去掉尾部供应商编码，柱状图按名称合并', () => {
  assert.equal(vendorDisplayName('甲供应商 (V1)'), '甲供应商')
  assert.equal(vendorDisplayName('甲供应商（V1）'), '甲供应商')
  assert.equal(vendorDisplayName('甲供应商'), '甲供应商')
  assert.equal(vendorDisplayName('未标注供应商'), '未标注供应商')
  assert.equal(vendorDisplayName('(V1)'), '(V1)')
  assert.equal(vendorDisplayName('按名字匹配到 2 条，未确认：张三 / 李四'), '按名字匹配到 2 条，未确认：张三 / 李四')

  function extra(suspect: string, vendor: string) {
    return {
      summary: `首个嫌疑派件员：${suspect}｜供应商：${vendor}`,
      entries: [
        { label: '首个嫌疑派件员', value: suspect },
        { label: '所属供应商', value: vendor },
      ],
    }
  }

  const analytics = buildInHubLossAnalytics([
    row({ orderNo: 'a1', orderInfo: orderInfo('EE033'), extraData: extra('张派', '甲供应商 (V1)') }),
    row({ orderNo: 'a2', orderInfo: orderInfo('Tjj00'), extraData: extra('王派', '甲供应商 (V1)') }),
    row({ orderNo: 'b1', orderInfo: orderInfo('R9'), extraData: extra('李派', '乙供应商 (V2)') }),
  ])

  assert.deepEqual(
    analytics.vendorMix.map((item) => [item.key, item.count]),
    [
      ['甲供应商', 2],
      ['乙供应商', 1],
    ],
  )
  assert.deepEqual(
    resolveVendorDrillView(analytics, { vendor: '甲供应商', route: null }).data.map((item) => item.key),
    ['EE033', 'Tjj00'],
  )
  // 桑基图与流向表仍保留带编码的原值
  assert.equal(analytics.flows[0]?.vendor, '甲供应商 (V1)')
})
