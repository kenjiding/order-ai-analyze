import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUS_TZ, iMileStrToMs, localDateTimeToMs } from '../imile/ausTimezone'
import {
  aggregateDispatch24hByScopes,
  aggregateDispatch24hByVendor,
  getDispatch24hDeadlineMs,
  isDispatch24hMet,
  isDispatch24hProblem,
  isDispatch24hTerminal,
  dispatchExitThresholdMs,
  isDispatch24hWindowExpired,
  resolveDispatch24hWindowRule,
  selectWaybillNosNeedingRefresh,
  type Dispatch24hScope,
  type Dispatch24hWaybillRow,
} from './dispatch24hAggregate'

const tz = AUS_TZ.Adelaide
// 本文件的样例 deliveryTime 都落在工作日、且批次到件日在周一~周四，走滚动 24h 窗口。
// 到件日 → 窗口规则的日历推导另见 resolveDispatch24hWindowRule 的专项用例。
const rule = resolveDispatch24hWindowRule('2024-06-24', tz) // 周一到件 → rolling24h

test('isDispatch24hTerminal：已达标视为终态，无需再拉', () => {
  const row: Dispatch24hWaybillRow = {
    waybillNo: 'W1',
    deliveryTime: '2024-06-24 10:00:00',
    signDate: '2024-06-24 12:00:00',
  }
  assert.equal(isDispatch24hMet(row, rule), true)
  assert.equal(isDispatch24hTerminal(row, rule), true)
})

test('isDispatch24hTerminal：未拿到签收时间时，即使窗口已过、缓存已是窗口后同步的，也不能锁定终态；signDate 一旦写入即为终态', () => {
  const row: Dispatch24hWaybillRow = {
    waybillNo: 'W2',
    deliveryTime: '2024-06-24 10:00:00',
  }
  const deadline = getDispatch24hDeadlineMs(row, rule)
  assert.ok(deadline != null)
  const withinWindow = deadline - 60_000
  const afterWindow = deadline + 60_000

  assert.equal(isDispatch24hWindowExpired(row, rule, withinWindow), false)
  assert.equal(isDispatch24hTerminal(row, rule), false)
  assert.equal(isDispatch24hMet(row, rule), false)
  assert.equal(isDispatch24hWindowExpired(row, rule, afterWindow), true)

  // 窗口已过，但 signDate 仍为空：iMile 可能之后才补上签收记录（签收超时），不能锁定终态，必须继续拉
  const staleSynced: Dispatch24hWaybillRow = { ...row, syncedAtMs: afterWindow }
  assert.equal(isDispatch24hTerminal(staleSynced, rule), false)

  // 窗口过后才补上的签收记录（签收超时）：signDate 一旦写入就不会再变，视为终态
  const lateSigned: Dispatch24hWaybillRow = {
    ...row,
    signDate: '2024-06-26 09:00:00',
    syncedAtMs: afterWindow,
  }
  assert.equal(isDispatch24hMet(lateSigned, rule), false)
  assert.equal(isDispatch24hTerminal(lateSigned, rule), true)
})

test('selectWaybillNosNeedingRefresh：只返回未终态单号', () => {
  const met: Dispatch24hWaybillRow = {
    waybillNo: 'A',
    deliveryTime: '2024-06-24 10:00:00',
    signDate: '2024-06-24 12:00:00',
  }
  const open: Dispatch24hWaybillRow = {
    waybillNo: 'B',
    deliveryTime: '2024-06-24 10:00:00',
  }
  const deadline = getDispatch24hDeadlineMs(open, rule)!
  // 窗口已过、缓存也是窗口后同步的，但 signDate 仍为空：不能锁定终态，仍需刷新（防止漏掉签收超时的单）
  const expiredSynced: Dispatch24hWaybillRow = {
    waybillNo: 'C',
    deliveryTime: '2024-06-24 10:00:00',
    syncedAtMs: deadline + 10_000,
  }
  // 窗口过后才补上的签收记录：signDate 已写入，视为终态，无需再刷新
  const lateSigned: Dispatch24hWaybillRow = {
    waybillNo: 'E',
    deliveryTime: '2024-06-24 10:00:00',
    signDate: '2024-06-26 09:00:00',
    syncedAtMs: deadline + 10_000,
  }
  const cached = new Map<string, Dispatch24hWaybillRow>([
    ['A', met],
    ['B', open],
    ['C', expiredSynced],
    ['E', lateSigned],
  ])

  assert.deepEqual(selectWaybillNosNeedingRefresh(['A', 'B', 'C', 'D'], cached, rule), ['B', 'C', 'D'])
  assert.deepEqual(selectWaybillNosNeedingRefresh(['A', 'B', 'C', 'D', 'E'], cached, rule), [
    'B',
    'C',
    'D',
  ])
})

test('isDispatch24hProblem：问题件时间需晚于派件时间才算本次派送产生的问题件', () => {
  // 第一次派送 10:00 上报问题件 18:00，未被重新派送：问题件有效
  const currentAttempt: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-24 10:00:00',
    lastProblemDate: '2024-06-24 18:00:00',
  }
  assert.equal(isDispatch24hProblem(currentAttempt), true)

  // 第一次派送 10:00 上报问题件后，包裹被重新派送（第二次 deliveryTime 晚于问题件时间）：旧问题件不算数
  const redispatched: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-25 09:00:00',
    lastProblemDate: '2024-06-24 18:00:00',
  }
  assert.equal(isDispatch24hProblem(redispatched), false)

  // 问题件时间恰好等于派件时间：按“不算”处理（严格要求晚于）
  const equalTime: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-24 10:00:00',
    lastProblemDate: '2024-06-24 10:00:00',
  }
  assert.equal(isDispatch24hProblem(equalTime), false)
})

test('isDispatch24hMet：重新派送后旧问题件不能再当作达标依据', () => {
  const deadline = getDispatch24hDeadlineMs({ deliveryTime: '2024-06-25 09:00:00' }, rule)!
  // 未签收、问题件是重新派送前的旧记录（早于本次 deliveryTime），即使在 deadline 前也不能判定达标
  const row: Dispatch24hWaybillRow = {
    deliveryTime: '2024-06-25 09:00:00',
    lastProblemDate: '2024-06-24 18:00:00',
  }
  assert.ok(deadline > iMileStrToMs('2024-06-24 18:00:00'))
  assert.equal(isDispatch24hMet(row, rule), false)
})

test('aggregateDispatch24hByVendor：同 vendorCode 按不同 routeCode 纳入时可拆成独立统计', () => {
  const rows: Dispatch24hWaybillRow[] = [
    {
      waybillNo: 'A1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
    {
      waybillNo: 'B1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-B',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]

  const regionA = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    rule,
    routeCodesByVendor: new Map([['V1', new Set(['R-A'])]]),
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')
  const regionB = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    rule,
    routeCodesByVendor: new Map([['V1', new Set(['R-B'])]]),
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')

  assert.equal(regionA?.total, 1)
  assert.deepEqual(regionA?.unmetNos, [])
  assert.equal(regionB?.total, 1)
  assert.deepEqual(regionB?.unmetNos, [])
})

test('aggregateDispatch24hByVendor：problemCount 按供应商与司机两级统计，重新派送的旧问题件不计入', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 本次派送产生的有效问题件：计入
    {
      waybillNo: 'P1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      lastProblemDate: '2024-06-24 18:00:00',
    },
    // 第一次派送的问题件，随后被重新派送：不计入
    {
      waybillNo: 'P2',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-25 09:00:00',
      lastProblemDate: '2024-06-24 18:00:00',
    },
    // 正常签收，无问题件
    {
      waybillNo: 'P3',
      courierCode: 'C2',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-B',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]

  const stat = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    rule,
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')

  assert.equal(stat?.total, 3)
  assert.equal(stat?.problemCount, 1)

  const c1 = stat?.drivers.find((d) => d.courierCode === 'C1')
  const c2 = stat?.drivers.find((d) => d.courierCode === 'C2')
  assert.equal(c1?.problemCount, 1)
  assert.equal(c2?.problemCount, 0)
  assert.deepEqual(
    c1?.problemWaybills.map((w) => w.waybillNo),
    ['P1'],
  )
  assert.deepEqual(c2?.problemWaybills, [])
})

test('aggregateDispatch24hByVendor：未达标运单按 neverSigned/lateSigned 分别收集运单号，不再混进同一个列表', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 从未签收
    {
      waybillNo: 'N1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
    },
    // 签收但超过 24H 窗口
    {
      waybillNo: 'L1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-B',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-26 09:00:00',
    },
    // 窗口内签收，达标
    {
      waybillNo: 'M1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]

  const stat = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    rule,
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')
  const c1 = stat?.drivers.find((d) => d.courierCode === 'C1')

  assert.equal(c1?.neverSignedCount, 1)
  assert.equal(c1?.lateSignedCount, 1)
  assert.deepEqual(
    c1?.neverSignedWaybills.map((w) => w.waybillNo),
    ['N1'],
  )
  assert.deepEqual(
    c1?.lateSignedWaybills.map((w) => w.waybillNo),
    ['L1'],
  )
})

test('aggregateDispatch24hByVendor：尚未派件（无 deliveryTime）的单也计入 total，按未达标（从未签收）处理', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 已派件、按时签收：达标
    {
      waybillNo: 'D1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
    // 尚未派件：courierVendorCode 已知，但 deliveryTime/courierCode 都还没有（司机没来出货）
    {
      waybillNo: 'D2',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
    },
  ]

  const stat = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    rule,
    routeCodeWhitelistByVendor: new Map(),
  }).get('V1')

  assert.equal(stat?.total, 2)
  assert.equal(stat?.met, 1)
  assert.equal(stat?.neverSignedCount, 1)
  assert.deepEqual(stat?.unmetNos, ['D2'])
  // 没有司机可归（courierCode 为空），未派件的单不出现在任何司机明细里
  assert.deepEqual(
    stat?.drivers.map((d) => d.courierCode),
    ['C1'],
  )
  // 但要单独成桶，否则推送卡片/落地页会漏掉这部分未达标单（显示「16 单未签收」却写「全部已签收」）
  assert.equal(stat?.unassigned?.total, 1)
  assert.equal(stat?.unassigned?.met, 0)
  assert.equal(stat?.unassigned?.neverSignedCount, 1)
  assert.deepEqual(
    stat?.unassigned?.neverSignedWaybills.map((w) => w.waybillNo),
    ['D2'],
  )
  // 未达标数可被完整拆解：司机维度 + 未分配 = 供应商维度
  const driverUnmet = (stat?.drivers ?? []).reduce((sum, d) => sum + (d.total - d.met), 0)
  assert.equal(driverUnmet + (stat?.unassigned ? stat.unassigned.total - stat.unassigned.met : 0), 1)
})

test('aggregateDispatch24hByVendor：courierVendorCode 为空时按 consigneeRouteCode 反查兜底归属；两家供应商共担同一路由码时各自独立计入，不是互斥归属', () => {
  const rows: Dispatch24hWaybillRow[] = [
    // 尚未派件：courierVendorCode 为空，靠 routeCode 反查兜底到 V1（仅 V1 配置了这个路由码）
    {
      waybillNo: 'F1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
    },
    // routeCode 同时配置在 V1、V2 名下（两家共担同一路由）：各自独立匹配，两边 total 都要算上这单
    {
      waybillNo: 'F2',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-SHARED',
    },
    // routeCode 未配置给任何供应商，无法兜底
    {
      waybillNo: 'F3',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-UNKNOWN',
    },
  ]

  const result = aggregateDispatch24hByVendor({
    rows,
    stationCodes: ['S1'],
    rule,
    routeCodesByVendor: new Map([
      ['V1', new Set(['R-A', 'R-SHARED'])],
      ['V2', new Set(['R-SHARED'])],
    ]),
    routeCodeWhitelistByVendor: new Map(),
  })

  const v1 = result.get('V1')
  const v2 = result.get('V2')
  assert.equal(v1?.total, 2)
  assert.deepEqual(v1?.unmetNos.sort(), ['F1', 'F2'])
  assert.equal(v2?.total, 1)
  assert.deepEqual(v2?.unmetNos, ['F2'])
})

test('aggregateDispatch24hByScopes：同 vendorCode 两条配置各自不同 routeCode 范围，一次遍历下依然各自独立统计，不互相覆盖', () => {
  const rows: Dispatch24hWaybillRow[] = [
    {
      waybillNo: 'A1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-A',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
    {
      waybillNo: 'B1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-B',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]

  const scopes: Dispatch24hScope[] = [
    { key: 'config-region-a', vendorCode: 'V1', routeCodes: new Set(['R-A']) },
    { key: 'config-region-b', vendorCode: 'V1', routeCodes: new Set(['R-B']) },
  ]
  const result = aggregateDispatch24hByScopes({ rows, stationCodes: ['S1'], rule, scopes })

  assert.equal(result.get('config-region-a')?.total, 1)
  assert.equal(result.get('config-region-b')?.total, 1)
})

test('aggregateDispatch24hByScopes：两个不同 vendorCode 共担同一路由码时各自独立计入；courierVendorCode 为空按 routeCode 兜底', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { waybillNo: 'F1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-A' },
    { waybillNo: 'F2', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-SHARED' },
    { waybillNo: 'F3', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-UNKNOWN' },
  ]
  const scopes: Dispatch24hScope[] = [
    { key: 'cfg-v1', vendorCode: 'V1', routeCodes: new Set(['R-A', 'R-SHARED']) },
    { key: 'cfg-v2', vendorCode: 'V2', routeCodes: new Set(['R-SHARED']) },
  ]
  const result = aggregateDispatch24hByScopes({ rows, stationCodes: ['S1'], rule, scopes })

  assert.equal(result.get('cfg-v1')?.total, 2)
  assert.equal(result.get('cfg-v2')?.total, 1)
})

test('aggregateDispatch24hByScopes：explicit courierVendorCode 不匹配任何 scope 时不计入任何桶；未配置 routeCode 的 scope 对 explicit 归属不做路由限制', () => {
  const rows: Dispatch24hWaybillRow[] = [
    {
      waybillNo: 'G1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-ANY',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
    {
      waybillNo: 'G2',
      courierCode: 'C1',
      courierVendorCode: 'V99',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-ANY',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]
  const scopes: Dispatch24hScope[] = [{ key: 'cfg-v1-norestrict', vendorCode: 'V1' }]
  const result = aggregateDispatch24hByScopes({ rows, stationCodes: ['S1'], rule, scopes })

  // V1 未配置 routeCode（scope.routeCodes 缺省）→ explicit 归属不受路由限制，G1 计入
  assert.equal(result.get('cfg-v1-norestrict')?.total, 1)
  assert.deepEqual(
    result.get('cfg-v1-norestrict')?.drivers.map((d) => d.courierCode),
    ['C1'],
  )
  // G2 显式归属 V99，不在 scopes 里，不应出现在任何结果中
  assert.equal(result.size, 1)
})

test('aggregateDispatch24hByScopes：路由码白名单剔除在单次遍历下依然生效', () => {
  const rows: Dispatch24hWaybillRow[] = [
    {
      waybillNo: 'H1',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-BLOCKED',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
    {
      waybillNo: 'H2',
      courierCode: 'C1',
      courierVendorCode: 'V1',
      lastScanSiteCode: 'S1',
      consigneeRouteCode: 'R-OK',
      deliveryTime: '2024-06-24 10:00:00',
      signDate: '2024-06-24 12:00:00',
    },
  ]
  const scopes: Dispatch24hScope[] = [
    { key: 'cfg-v1', vendorCode: 'V1', routeCodeWhitelist: new Set(['R-BLOCKED']) },
  ]
  const result = aggregateDispatch24hByScopes({ rows, stationCodes: ['S1'], rule, scopes })

  assert.equal(result.get('cfg-v1')?.total, 1)
  assert.deepEqual(result.get('cfg-v1')?.drivers[0]?.total, 1)
})

test('aggregateDispatch24hByScopes：与 aggregateDispatch24hByVendor 逐配置调用结果等价（同一份 rows，含共享路由/独立路由范围混合场景）', () => {
  const rows: Dispatch24hWaybillRow[] = [
    { waybillNo: 'E1', courierCode: 'C1', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-A', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-24 12:00:00' },
    { waybillNo: 'E2', courierCode: 'C2', courierVendorCode: 'V1', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-B', deliveryTime: '2024-06-24 10:00:00' },
    { waybillNo: 'E3', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-SHARED' },
    { waybillNo: 'E4', courierCode: 'C3', courierVendorCode: 'V2', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-C', lastProblemDate: '2024-06-24 20:00:00', deliveryTime: '2024-06-24 10:00:00' },
    { waybillNo: 'E5', courierCode: 'C1', courierVendorCode: 'V3', lastScanSiteCode: 'S1', consigneeRouteCode: 'R-D', deliveryTime: '2024-06-24 10:00:00', signDate: '2024-06-26 09:00:00' },
  ]

  const configs = [
    { key: 'cfg-1', vendorCode: 'V1', routeCodes: new Set(['R-A', 'R-B', 'R-SHARED']) },
    { key: 'cfg-2', vendorCode: 'V2', routeCodes: new Set(['R-SHARED']), routeCodeWhitelist: new Set(['R-C']) },
    { key: 'cfg-3', vendorCode: 'V3' },
  ]

  // 旧路径：逐配置各自调用 aggregateDispatch24hByVendor
  const expected = new Map(
    configs.map((c) => [
      c.key,
      aggregateDispatch24hByVendor({
        rows,
        stationCodes: ['S1'],
        rule,
        routeCodesByVendor: c.routeCodes ? new Map([[c.vendorCode, c.routeCodes]]) : new Map(),
        routeCodeWhitelistByVendor: c.routeCodeWhitelist ? new Map([[c.vendorCode, c.routeCodeWhitelist]]) : new Map(),
      }).get(c.vendorCode),
    ]),
  )

  // 新路径：一次遍历
  const actual = aggregateDispatch24hByScopes({
    rows,
    stationCodes: ['S1'],
    rule,
    scopes: configs.map((c) => ({ key: c.key, vendorCode: c.vendorCode, routeCodes: c.routeCodes, routeCodeWhitelist: c.routeCodeWhitelist })),
  })

  for (const c of configs) {
    const exp = expected.get(c.key)
    const act = actual.get(c.key)
    assert.equal(act?.total, exp?.total, `${c.key} total`)
    assert.equal(act?.met, exp?.met, `${c.key} met`)
    assert.equal(act?.problemCount, exp?.problemCount, `${c.key} problemCount`)
    assert.equal(act?.neverSignedCount, exp?.neverSignedCount, `${c.key} neverSignedCount`)
    assert.equal(act?.lateSignedCount, exp?.lateSignedCount, `${c.key} lateSignedCount`)
    assert.deepEqual(
      act?.drivers.map((d) => ({ courierCode: d.courierCode, total: d.total, met: d.met })),
      exp?.drivers.map((d) => ({ courierCode: d.courierCode, total: d.total, met: d.met })),
      `${c.key} drivers`,
    )
  }
})

test('resolveDispatch24hWindowRule：周一~周四到件走滚动24h，周五/周六/周日到件统一压到下周一23:59:59', () => {
  // 2024-06-24 周一 … 2024-06-30 周日
  for (const d of ['2024-06-24', '2024-06-25', '2024-06-26', '2024-06-27']) {
    assert.deepEqual(resolveDispatch24hWindowRule(d, tz), { kind: 'rolling24h' }, d)
  }

  // 周五/周六/周日三批的截止时刻必须是同一个：下周一 07-01 23:59:59（本地）
  const expected = localDateTimeToMs('2024-07-01 23:59:59', tz)
  for (const d of ['2024-06-28', '2024-06-29', '2024-06-30']) {
    assert.deepEqual(resolveDispatch24hWindowRule(d, tz), { kind: 'fixedDeadline', deadlineMs: expected }, d)
  }
})

test('resolveDispatch24hWindowRule：周四到件的批次不因「周五出仓」被误判成周末顺延', () => {
  // 这是本次口径修正的核心：窗口按到件日判，不按 deliveryTime 的星期判。
  // 周四 06-27 到件 → 周五 06-28 出仓 → 截止是周六 06-29 同时刻，而不是下周一 23:59:59。
  const rule = resolveDispatch24hWindowRule('2024-06-27', tz)
  assert.deepEqual(rule, { kind: 'rolling24h' })

  const row: Dispatch24hWaybillRow = { waybillNo: 'THU', deliveryTime: '2024-06-28 09:00:00' }
  assert.equal(getDispatch24hDeadlineMs(row, rule), iMileStrToMs('2024-06-29 09:00:00'))

  // 周六 08:00 签收 → 达标；下周一才签收 → 不达标（旧口径下会误判成达标）
  assert.equal(isDispatch24hMet({ ...row, signDate: '2024-06-29 08:00:00' }, rule), true)
  assert.equal(isDispatch24hMet({ ...row, signDate: '2024-07-01 20:00:00' }, rule), false)
})

test('getDispatch24hDeadlineMs：固定截止批次即使尚未派件也有截止时刻（滚动批次则无法起算）', () => {
  const fixed = resolveDispatch24hWindowRule('2024-06-28', tz)
  assert.equal(getDispatch24hDeadlineMs({ waybillNo: 'X' }, fixed), localDateTimeToMs('2024-07-01 23:59:59', tz))
  assert.equal(getDispatch24hDeadlineMs({ waybillNo: 'X' }, { kind: 'rolling24h' }), null)
})

test('dispatchExitThresholdMs：出仓阈值恒锚在到件日次日的11:00，周末不跳过', () => {
  // 周三到件 → 周四 11:00
  assert.equal(dispatchExitThresholdMs('2024-06-26', tz), localDateTimeToMs('2024-06-27 11:00:00', tz))
  // 周五到件 → 周六 11:00。周六不开仓分拣，但司机照常来取周五分拣好的货出仓派送，
  // 按分拣日历推到下周一会让周六整天算不出出仓率（本次口径修正的核心）。
  assert.equal(dispatchExitThresholdMs('2024-06-28', tz), localDateTimeToMs('2024-06-29 11:00:00', tz))
  // 出仓阈值与派签窗口就此脱钩：同一批周五到件的货，出仓看周六 11:00、派签仍到下周一 23:59:59
  assert.deepEqual(resolveDispatch24hWindowRule('2024-06-28', tz), {
    kind: 'fixedDeadline',
    deadlineMs: localDateTimeToMs('2024-07-01 23:59:59', tz),
  })
})
