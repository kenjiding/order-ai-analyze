import assert from 'node:assert/strict'
import test from 'node:test'
import type { ScanInterceptLog } from '../imile/interceptLogs'
import { normalizeTrackEvent } from '../imile/track'
import type { TrackEvent } from '../imile/track'
import { compareRegressionCase } from './regression/compare'
import { applyFactGuardrails } from './decisionRules'
import { normalizeSubType } from './exceptionCatalog'
import { parseOrderAnalyzeResults, prepareAnalyzeCategories } from './prompt'
import { deriveTrackFacts, summarizeTracks } from './trackFacts'
import { formatCurrentResponsibilityParty } from './pipeline'
import { classifyOperatorForWarehouse, findWarehouseProfileByName } from './warehouseProfiles'
import type { OrderAnalyzeResult, TrackFacts } from './types'

function track(time: string, content: string, trackType = '', trackStageTx = ''): TrackEvent {
  return { time, content, trackType, trackStageTx }
}

function daysAgo(days: number, time = '10:00:00'): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return `${d.toISOString().slice(0, 10)} ${time}`
}

function baseResult(patch: Partial<OrderAnalyzeResult> = {}): OrderAnalyzeResult {
  return {
    orderNo: 'T1',
    lossScope: '库内丢失',
    exceptionCategoryId: '',
    reason: '模型初判',
    confidence: 0.9,
    ...patch,
  }
}

test('normalizeTrackEvent 保留完整业务文本仅去掉 HTML', () => {
  const normalized = normalizeTrackEvent({
    time: '2026.05.01 21:04',
    trackType: '<span>Delivery</span>',
    trackStageTx: '<b>派送</b>',
    content:
      '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: +61 412 345 678)。<script>alert(1)</script>操作员【ADL-JC-city-A】',
  })

  assert.deepEqual(normalized, {
    time: '2026-05-01 21:04:00',
    trackType: 'Delivery',
    trackStageTx: '派送',
    content:
      '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: +61 412 345 678)。操作员【ADL-JC-city-A】',
  })
})

test('商家销毁终态优先纠正为暂无异常', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '操作员【10001】 已盘点'),
    track('2024-01-02 10:00:00', '商家已反馈NDR处理意见[销毁]'),
  ])
  const guarded = applyFactGuardrails(baseResult(), facts)

  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.needsReview, true)
  assert.equal(guarded.appliedDecisionRuleId, 'merchant_destroy_terminal')
})

test('商家暂存未预约派送时纠正为暂无异常且子类型为暂存', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '操作员【10001】 已盘点'),
    track('2024-01-02 10:00:00', '包裹确认派送结束, 将按照商家反馈意见[暂存]进行处理'),
  ])
  const guarded = applyFactGuardrails(baseResult(), facts)

  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '暂存')
  assert.equal(guarded.needsReview, false)
})

test('暂存后出现预约派送会释放暂存状态', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '操作员【10001】 已盘点'),
    track('2024-01-02 10:00:00', '商家已反馈NDR处理意见[暂存]'),
    track('2024-01-03 10:00:00', '已预约进行派送', 'schedule'),
  ])

  assert.equal(facts.merchantStorageActive, false)
  assert.equal(facts.merchantStorageReleasedBySchedule, true)
})

test('退返商家闭环纠正为暂无异常且子类型为退返商家', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track('2024-01-03 10:00:00', '【ADL DS】退件已退返商家。操作员【ADL OP1】'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库内丢失' }), facts)

  assert.equal(facts.merchantReturnConfirmed, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '退返商家')
  assert.equal(guarded.appliedDecisionRuleId, 'merchant_return_terminal')
})

test('NDR 退返商家终态优先于当前责任段缺证据兜底', () => {
  const inventoryTime = '2026-05-05 13:44:47'
  const facts = deriveTrackFacts(
    [
      track('2026-04-26 14:07:05', '已通过[OpenApi]成功下单', '', '订单提交'),
      track('2026-05-01 18:25:06', '【Adelaide Center】已揽收, 操作员【System】。', '', '已揽件'),
      track('2026-05-01 18:25:36', '【Adelaide Center】已到达。操作员【ADL-DC-Jacky】 。', '', '转运'),
      track('2026-05-01 18:25:37', '【Adelaide Center】完成待转发件，目的地【ADL DS】。操作员【System】', '', '转运'),
      track('2026-05-01 18:25:38', '【ADL DS】已到达。操作员【System】 。', '', '派送'),
      track('2026-05-01 20:10:10', '【ADL DS】派送任务已分配给派件员(派件员：ADL-CXH-326-ALIJAFARI,电话：***)，待派件员领取包裹。 操作员【cornerstone】', '', '派送'),
      track('2026-05-01 21:04:24', '【ADL DS】包裹正在派送中(派件员: ADL-CXH-326-ALIJAFARI, ***)。操作员【ADL-CXH-326-ALIJAFARI】', 'Delivery', '派送'),
      track('2026-05-02 15:59:57', '【ADL DS】登记问题件[AUS| 无人在家，无安全环境放包裹], 操作员【ADL-CXH-326-ALIJAFARI】。【View Proof】', 'Problem', '派送'),
      track('2026-05-05 08:45:00', '【ADL DS】派件员已回到网点。操作员【ADL-前台】', '', '派送'),
      track(inventoryTime, '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
      track('2026-05-24 16:16:31', '【Adelaide Center】登记问题件[AUS| 商家要求退回], 操作员【IKHWAN NASIR BIN MOHAMAT TAHIR】。', 'Problem', '派送'),
      track('2026-05-24 16:16:32', '【ADL DS】已进入NDR，NDR来源[问题件触发NDR]', '', '派送'),
      track('2026-05-24 16:18:04', '商家已反馈NDR处理意见[退返商家]。 操作人【IKHWAN NASIR BIN MOHAMAT TAHIR】', '', '退件处理'),
      track('2026-05-24 16:18:05', '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
      track('2026-05-24 16:19:05', '【ADL DS】退件已退返商家。操作员【ADL OP1】', '', '已退返商家'),
    ],
    [
      {
        waybillNo: '6042626269916',
        scanUserCode: '2103297501',
        scanUserName: 'ADL OP1',
        gmtIntercept: '2026-05-01 21:17:07',
        operatorType: 'unknown',
      },
    ]
  )
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '暂无异常', exceptionCategoryId: '退返商家', reason: '退返商家' }),
    facts
  )

  assert.equal(facts.activeWarehouseHubId, 'adelaide_ds')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, inventoryTime)
  assert.equal(facts.merchantReturnConfirmed, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '退返商家')
  assert.equal(guarded.appliedDecisionRuleId, undefined)
})

test('已退返商家终态不被公司仓缺证据兜底覆盖', () => {
  const facts = deriveTrackFacts([
    track('2026-05-19 14:39:30', '【ADL DS】退件已退返商家。操作员【ADL OP1】', '', '已退返商家'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({
      lossScope: '暂无异常',
      exceptionCategoryId: '退返商家',
      reason: '包裹已退返商家闭环',
      confidence: 0.65,
    }),
    facts
  )

  assert.equal(facts.activeResponsibilityOwner, 'company_warehouse')
  assert.equal(facts.hasRealOperatorScan, false)
  assert.equal(facts.merchantReturnConfirmed, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '退返商家')
  assert.equal(guarded.appliedDecisionRuleId, undefined)
})

test('退返商家已正确闭环时不被后续退件装箱和缺证据兜底覆盖', () => {
  const facts = deriveTrackFacts(
    [
      track('2026-05-12 21:32:39', '【ADL DS】包裹正在派送中(派件员: ARYAN VIJAYKUMAR PATEL, ***)。操作员【ARYAN VIJAYKUMAR PATEL】', 'Delivery', '派送'),
      track('2026-05-14 08:49:08', '【ADL DS】登记问题件[AUS| 商业、办公室地址，无安全环境放包裹], 操作员【ARYAN VIJAYKUMAR PATEL】。【View Proof】', 'Problem', '派送'),
      track('2026-05-14 08:52:07', '【ADL DS】派件员已回到网点。操作员【ADL-前台】', '', '派送'),
      track('2026-05-14 13:44:08', '已预约【2026-05-18】进行派送。操作员【ADL OP1】', 'Schedule', '派送'),
      track('2026-05-14 13:53:04', '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
      track('2026-05-14 19:43:13', '【ADL DS】包裹正在派送中(派件员: ADL-JC-027-DAVID BHARATBHAI PATEL, ***)。操作员【ADL-JC-027-DAVID BHARATBHAI PATEL】', 'Delivery', '派送'),
      track('2026-05-15 20:15:36', '【ADL DS】登记问题件[AUS| 店铺关门], 操作员【ADL-JC-027-DAVID BHARATBHAI PATEL】。【View Proof】', 'Problem', '派送'),
      track('2026-05-16 09:26:51', '【ADL DS】已进入NDR，NDR来源[超NDR派件次数/供应商退件到件]', '', '派送'),
      track('2026-05-16 09:26:51', '【ADL DS】派件员已回到网点。操作员【ADL-前台】', '', '派送'),
      track('2026-05-17 13:40:01', '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
      track('2026-05-18 08:01:04', '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
      track('2026-05-19 11:27:35', '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '退件处理'),
      track('2026-05-19 14:32:31', '【ADL DS】已装箱，集包号[2605192882801]，目的地【TEMU-EI_LM_AUS】。操作员【ADL-前台】', '', '退件处理'),
      track('2026-05-19 14:39:30', '【ADL DS】退件已退返商家。操作员【ADL OP1】', '', '已退返商家'),
    ],
    [
      {
        waybillNo: '6050426015438',
        scanUserCode: '2103297501',
        scanUserName: 'ADL OP1',
        gmtIntercept: '2026-05-09 10:15:09',
        operatorType: 'unknown',
      },
    ]
  )
  const guarded = applyFactGuardrails(
    baseResult({
      lossScope: '暂无异常',
      exceptionCategoryId: '退返商家',
      reason: '商家已反馈退返商家意见，包裹已退返商家闭环',
      confidence: 0.65,
    }),
    facts
  )

  assert.equal(facts.merchantReturnConfirmed, true)
  assert.equal(facts.activeSegmentStatus, 'in_warehouse')
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '退返商家')
  assert.equal(guarded.appliedDecisionRuleId, undefined)
})

test('暂存后出现退件意见时释放暂存，但不当作退返闭环', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '操作员【10001】 已盘点'),
    track('2024-01-02 10:00:00', '商家已反馈NDR处理意见[暂存]'),
    track('2024-01-03 10:00:00', '商家已反馈退件处理意见[退回商家]'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '暂无异常', exceptionCategoryId: '暂存' }),
    facts
  )

  assert.equal(facts.merchantStorageActive, false)
  assert.equal(facts.merchantStorageSupersededByBusinessProgress, true)
  assert.equal(facts.merchantReturnConfirmed, false)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '')
  assert.equal(guarded.appliedDecisionRuleId, 'merchant_storage_superseded_by_progress')
})

test('暂存释放后库内最终责任已超时，原始库内判断不应被事实校验反转', () => {
  const interceptTime = daysAgo(19, '07:40:19')
  const facts = deriveTrackFacts(
    [
      track(daysAgo(25, '13:53:57'), '【Canberra Station】已盘点，库位编号[CBR2-1]。操作员【CBR Warehouse3】'),
      track(daysAgo(22, '08:03:20'), '【Canberra Station】包裹确认派送结束, 将按照商家反馈意见[暂存]进行处理。'),
      track(daysAgo(21, '16:18:10'), '【Canberra Station】已装箱，集包号[2605064728701]，目的地【Sydney Center】。操作员【CBR Warehouse3】'),
      track(daysAgo(20, '13:26:41'), '【Sydney Center】已收到退件包裹。操作员【SYD-Force Assign-1】'),
      track(daysAgo(20, '15:50:55'), '商家已反馈退件处理意见[RTC]，操作员【刘欣】', '', '退件处理'),
    ],
    [
      {
        waybillNo: '6040726375227',
        scanUserCode: '2104556001',
        scanUserName: 'CBR Warehouse3',
        gmtIntercept: interceptTime,
        operatorType: 'scanner',
      },
    ]
  )
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '库内丢失', exceptionCategoryId: '扫描员丢失', reason: '模型初判库内超时' }),
    facts
  )

  assert.equal(facts.merchantStorageSupersededByBusinessProgress, true)
  assert.equal(facts.merchantReturnRequested, true)
  assert.equal(facts.activeWarehouseName, 'Sydney Center')
  assert.equal(facts.finalResponsibilityOwner, 'in_warehouse')
  assert.equal(facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays, true)
  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.exceptionCategoryId, '扫描员丢失')
  assert.equal(guarded.appliedDecisionRuleId, undefined)
})

test('暂存释放后库内最终责任已超时，AI 暂无异常误判应被强事实纠正', () => {
  const interceptTime = daysAgo(19, '07:40:19')
  const facts = deriveTrackFacts(
    [
      track(daysAgo(25, '13:53:57'), '【Canberra Station】已盘点，库位编号[CBR2-1]。操作员【CBR Warehouse3】'),
      track(daysAgo(22, '08:03:20'), '【Canberra Station】包裹确认派送结束, 将按照商家反馈意见[暂存]进行处理。'),
      track(daysAgo(21, '16:18:10'), '【Canberra Station】已装箱，集包号[2605064728701]，目的地【Sydney Center】。操作员【CBR Warehouse3】'),
      track(daysAgo(20, '13:26:41'), '【Sydney Center】已收到退件包裹。操作员【SYD-Force Assign-1】'),
      track(daysAgo(20, '15:50:55'), '商家已反馈退件处理意见[RTC]，操作员【刘欣】', '', '退件处理'),
    ],
    [
      {
        waybillNo: '6040726375227',
        scanUserCode: '2104556001',
        scanUserName: 'CBR Warehouse3',
        gmtIntercept: interceptTime,
        operatorType: 'scanner',
      },
    ]
  )
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '暂无异常', exceptionCategoryId: '暂存', reason: '模型误按暂存终态' }),
    facts
  )

  assert.equal(facts.merchantStorageSupersededByBusinessProgress, true)
  assert.equal(facts.finalResponsibilityOwner, 'in_warehouse')
  assert.equal(facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays, true)
  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.exceptionCategoryId, '扫描员丢失')
  assert.notEqual(guarded.appliedDecisionRuleId, 'merchant_storage_superseded_by_progress')
})

test('商家退返方向未闭环且未超时，不使用退返商家子类型', () => {
  const inventoryTime = daysAgo(1, '10:00:00')
  const returnRequestTime = daysAgo(1, '16:18:05')
  const facts = deriveTrackFacts([
    track(inventoryTime, '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
    track(daysAgo(1, '16:18:04'), '商家已反馈NDR处理意见[退返商家]。 操作人【IKHWAN NASIR BIN MOHAMAT TAHIR】', '', '退件处理'),
    track(returnRequestTime, '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '暂无异常', exceptionCategoryId: '退返商家', reason: '退返商家' }),
    facts
  )

  assert.equal(facts.merchantReturnRequested, true)
  assert.equal(facts.merchantReturnConfirmed, false)
  assert.equal(facts.inWarehouseStartTime, inventoryTime)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '')
  assert.equal(guarded.appliedDecisionRuleId, 'merchant_return_in_progress_not_terminal')
})

test('商家退返方向不是库内真实责任点，不能覆盖 sorter 设备扫描起算', () => {
  const realScanTime = '2026-05-01 09:00:25'
  const facts = deriveTrackFacts([
    track(realScanTime, '【Sydney Center】已到达，包裹重量为【0kg】。操作员【sorter】 ,设备编码[AUS_S210312_01]', '', '派送'),
    track('2026-05-08 06:32:15', '【Sydney Center】派送任务已分配给派件员(派件员：BPE-1063-Yong Pei WONG,电话：***)，待派件员领取包裹。 操作员【cornerstone】', '', '派送'),
    track('2026-05-08 08:05:16', '【Sydney Center】包裹已取消分配给[BPE-1063-Yong Pei WONG]。操作员【SYD OPS2】', '', '派送'),
    track('2026-05-14 16:33:11', '【Sydney Center】登记问题件[派送失败，需退回。], 操作员【Frank Wang Xige】。', 'Problem', '派送'),
    track('2026-05-14 16:33:12', '【Sydney Center】已进入NDR，NDR来源[问题件触发NDR]', '', '派送'),
    track('2026-05-16 08:01:06', '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
  ])

  assert.equal(facts.merchantReturnRequested, true)
  assert.equal(facts.inWarehouseStartTime, realScanTime)
  assert.equal(facts.finalResponsibilityOwner, 'in_warehouse')
  assert.equal(facts.finalResponsibilityStartTime, realScanTime)
  assert.equal(facts.inWarehouseBasis?.includes('商家退返'), false)
})

test('商家退返方向后最新盘点重置仓内起算', () => {
  const inventoryTime = daysAgo(0, '15:01:57')
  const facts = deriveTrackFacts([
    track(daysAgo(20), '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
    track(daysAgo(1, '16:18:04'), '商家已反馈NDR处理意见[退返商家]。 操作人【IKHWAN NASIR BIN MOHAMAT TAHIR】', '', '退件处理'),
    track(daysAgo(1, '16:18:05'), '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
    track(inventoryTime, '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '退件处理'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '暂无异常', exceptionCategoryId: '退返商家', reason: '退返商家' }),
    facts
  )

  assert.equal(facts.merchantReturnRequested, true)
  assert.equal(facts.inWarehouseStartTime, inventoryTime)
  assert.equal(facts.inWarehouseDaysDiff < facts.activeWarehouseLossTimeoutDays, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '')
  assert.equal(guarded.appliedDecisionRuleId, 'merchant_return_in_progress_not_terminal')
})

test('商家退返方向后集包号表示库内责任已转移，未闭环也归入退返商家', () => {
  const packageTime = daysAgo(8, '14:32:31')
  const facts = deriveTrackFacts([
    track(daysAgo(20), '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
    track(daysAgo(9, '08:01:04'), '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
    track(packageTime, '【ADL DS】已装箱，集包号[2605192882801]，目的地【TEMU-EI_LM_AUS】。操作员【ADL-前台】', '', '退件处理'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '库内丢失', exceptionCategoryId: '扫描员丢失', reason: '模型误判库内超时' }),
    facts
  )

  assert.equal(facts.merchantReturnRequested, true)
  assert.equal(facts.merchantReturnConfirmed, false)
  assert.equal(facts.merchantReturnPackageTime, packageTime)
  assert.equal(facts.merchantReturnResponsibilityTransferred, true)
  assert.equal(facts.merchantReturnResponsibilityTransferTime, packageTime)
  assert.equal(facts.activeResponsibilityOwner, 'company_warehouse')
  assert.equal(facts.activeSegmentStatus, 'in_warehouse')
  assert.notEqual(facts.inWarehouseStartTime, packageTime)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.exceptionCategoryId, '退返商家')
  assert.equal(guarded.appliedDecisionRuleId, 'merchant_return_package_transferred')
  assert.equal(normalizeSubType({ lossScope: '暂无异常', facts }), '退返商家')
})

test('退件处理意见 Transfer 后目的仓收到退件，应切回目的仓并按库内超时纠正', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(90), '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
    track(daysAgo(80), '商家已反馈退件处理意见[Transfer]，操作员【Yanwen_AUS】', '', '退件处理'),
    track(daysAgo(61, '14:27:02'), '【Adelaide Center】已收到退件包裹。操作员【ADL-DC-Tong】', '', '退件处理'),
    track(daysAgo(61, '14:27:03'), '【Adelaide Center】完成待转发件，目的地【ADL DS】。操作员【System】', '', '退件处理'),
    track(daysAgo(61, '14:27:04'), '【ADL DS】已收到退件包裹。操作员【System】', '', '退件处理'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '暂无异常', exceptionCategoryId: '退返商家', reason: '退返商家' }),
    facts
  )

  assert.equal(facts.merchantReturnConfirmed, false)
  assert.equal(facts.activeResponsibilityOwner, 'company_warehouse')
  assert.equal(facts.activeSegmentStatus, 'in_warehouse')
  assert.equal(facts.activeWarehouseHubId, 'adelaide_ds')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.exceptionCategoryId, '扫描员丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'active_in_warehouse_overdue_is_in_warehouse_loss')
})

test('跨仓转运未超 10 天时责任转移出旧仓库', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(2), '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track(daysAgo(1), '【ADL DS】已装箱，目的地【Melbourne Center】。操作员【ADL-FrontDesk】'),
    track(daysAgo(0), '包裹正在处理中'),
  ])
  const guarded = applyFactGuardrails(baseResult(), facts)

  assert.equal(facts.transferToOtherHubInProgress, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.appliedDecisionRuleId, 'transfer_to_company_hub_not_overdue')
})

test('Melbourne 已转交 Australia Post 未超时时不沿用 ADL 库内起算', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(25), '已通过[OpenApi]成功下单'),
    track(daysAgo(15, '20:17:15'), '【ADL DS】已揽收, 操作员【System】。'),
    track(daysAgo(15, '20:17:45'), '【ADL DS】已装箱，集包号[2605085545201]，目的地【Melbourne Center】。操作员【ADL-前台】'),
    track(daysAgo(8), '包裹正在处理中。'),
    track(daysAgo(1, '23:03:34'), '【Melbourne Center】已到达。操作员【MEL_RDC_Scanner_11】 。'),
    track(daysAgo(1, '23:04:05'), '【Melbourne Center】包裹已转交至【Australia Post】进行承运。操作员【Mel_FrontDesk_1】'),
  ])
  const guarded = applyFactGuardrails(baseResult(), facts)

  assert.equal(facts.activeResponsibilityOwner, 'external_carrier')
  assert.equal(facts.activeExternalCarrierName, 'Australia Post')
  assert.equal(facts.inWarehouseStartTime, null)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.appliedDecisionRuleId, 'external_carrier_handoff_not_overdue')
})

test('标准转仓按装箱目的地和目的仓到达切换责任段', () => {
  const facts = deriveTrackFacts([
    track('2026-04-27 14:31:35', '【ADL DS】已到达。操作员【ADL OP1】 。', '', '转运'),
    track('2026-04-27 17:31:30', '【ADL DS】已装箱，集包号[2604271169201]，目的地【Melbourne Center】。操作员【ADL-前台】', '', '转运'),
    track('2026-05-03 11:25:20', '包裹正在处理中。', '', '转运'),
    track('2026-05-05 12:50:28', '【Melbourne Center】已到达。操作员【MEL_RDC_Scanner_15】 。', '', '派送'),
    track('2026-05-05 14:36:29', '【Melbourne Center】包裹已转交至【Australia Post】进行承运。操作员【Mel_FrontDesk_1】', '', '派送'),
  ])

  assert.deepEqual(
    facts.responsibilitySegments.map((segment) => [segment.owner, segment.status, segment.hubName, segment.carrierName]),
    [
      ['company_warehouse', 'in_warehouse', 'ADL DS', null],
      ['unknown', 'transit_to_company_hub', 'Melbourne Center', null],
      ['company_warehouse', 'in_warehouse', 'Melbourne Center', null],
      ['external_carrier', 'external_carrier', null, 'Australia Post'],
    ]
  )
  assert.equal(facts.activeResponsibilityOwner, 'external_carrier')
  assert.equal(facts.activeExternalCarrierName, 'Australia Post')
  assert.equal(facts.merchantReturnResponsibilityTransferred, false)
})

test('跨仓转运后目的仓出现回仓/盘点/归班等责任锚点时必须切回仓库责任段', () => {
  const facts = deriveTrackFacts([
    track('2026-05-01 10:00:00', '【ADL DS】已盘点，库位编号[01]。操作员【ADL-前台】', '', '派送'),
    track('2026-05-01 10:10:00', '【ADL DS】已装箱，集包号[2605010000001]，目的地【Melbourne Center】。操作员【ADL-前台】', '', '转运'),
    track('2026-05-03 09:00:00', '【Melbourne Center】已归班。操作员【MEL_RDC_Scanner_04】', '', '派送'),
  ])

  assert.equal(facts.activeResponsibilityOwner, 'company_warehouse')
  assert.equal(facts.activeSegmentStatus, 'in_warehouse')
  assert.equal(facts.activeWarehouseHubId, 'melbourne_center')
  assert.equal(facts.transferToOtherHubInProgress, false)
  assert.equal(facts.finalResponsibilityOwner, 'in_warehouse')
  assert.equal(facts.finalResponsibilityStartTime, '2026-05-03 09:00:00')
})

test('同目的地重复转运事件不应反复切回起始仓', () => {
  const facts = deriveTrackFacts([
    track('2026-05-04 08:34:27', '【Sydney Center】已揽收, 操作员【System】。', '', '转运'),
    track('2026-05-04 14:03:18', '【Sydney Center】已装箱，集包号[2604211588701]，目的地【SYDE】。操作员【SYD Warehouse6】', '', '转运'),
    track('2026-05-04 19:07:30', '【Sydney Center】完成待转发件，目的地【SYDE】。操作员【SYD Warehouse6】', '', '转运'),
    track('2026-05-04 19:30:01', '【SYDE】包号[2604211588701]已到达。操作员【SYDE OPS1】 。', '', '转运'),
  ])

  assert.deepEqual(
    facts.responsibilitySegments.map((segment) => [segment.owner, segment.status, segment.hubName]),
    [
      ['company_warehouse', 'in_warehouse', 'Sydney Center'],
      ['unknown', 'transit_to_company_hub', 'SYDE'],
      ['company_warehouse', 'in_warehouse', 'SYDE'],
    ]
  )
})

test('SYDE 仓库配置生效后不再标记为未知仓库', () => {
  const facts = deriveTrackFacts([
    track('2026-05-04 19:30:01', '【SYDE】包号[2604211588701]已到达。操作员【SYDE OPS1】 。', '', '转运'),
    track('2026-05-20 09:16:53', '【SYDE】派件员已回到网点。操作员【SYDE OPS1】', '', '派送'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'SYDE')
  assert.equal(facts.activeWarehouseKnown, true)
  assert.equal(facts.unknownWarehouseInActiveSegment, false)
})

test('已配置仓库最终责任未超时应纠正需人工判断', () => {
  const facts = deriveTrackFacts([
    track('2026-05-04 08:34:27', '【Sydney Center】已揽收, 操作员【System】。', '', '转运'),
    track('2026-05-04 08:34:57', '【Sydney Center】已到达，包裹重量为【0kg】。操作员【sorter】,设备编码[AUS_S210312_01]', '', '转运'),
    track('2026-05-04 14:03:18', '【Sydney Center】已装箱，集包号[2604211588701]，目的地【SYDE】。操作员【SYD Warehouse6】', '', '转运'),
    track('2026-05-04 19:07:30', '【Sydney Center】完成待转发件，目的地【SYDE】。操作员【SYD Warehouse6】', '', '转运'),
    track('2026-05-04 19:30:01', '【SYDE】包号[2604211588701]已到达。操作员【SYDE OPS1】 。', '', '转运'),
    track('2026-05-07 07:33:10', '【SYDE】派送任务已分配给派件员(派件员：PUS-567-Kunjin Wu,电话：+61 ***)，待派件员领取包裹。 操作员【SYDE OPS1】', '', '派送'),
    track('2026-05-07 07:33:11', '【SYDE】包裹正在派送中(派件员: PUS-567-Kunjin Wu, +61 ***)。操作员【SYDE OPS1】', 'delivery', '派送'),
    track('2026-05-20 09:16:53', '【SYDE】派件员已回到网点。操作员【SYDE OPS1】', '', '派送'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '需人工判断', reason: '模型保守判定', confidence: 0.95 }),
    facts
  )

  assert.equal(facts.activeWarehouseKnown, true)
  assert.equal(facts.finalResponsibilityOwner, 'in_warehouse')
  assert.equal(facts.finalResponsibilityDaysDiff >= 0 && facts.finalResponsibilityDaysDiff < facts.activeWarehouseLossTimeoutDays, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.needsReview, false)
  assert.equal(guarded.appliedDecisionRuleId, 'known_warehouse_not_overdue_clears_manual_review')
})

test('Australia Post 后续操作不切回公司仓且断更达到 7 天判定 3PL 丢件', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(30), '已通过[OpenApi]成功下单'),
    track(daysAgo(27), '【Adelaide Center】已揽收, 操作员【System】。'),
    track(daysAgo(27, '11:47:46'), '【Adelaide Center】已到达。操作员【ADL-DC-PanPan】 。'),
    track(daysAgo(26), '【ADL DS】已装箱，集包号[2604271169201]，目的地【Melbourne Center】。操作员【ADL-前台】'),
    track(daysAgo(19), '【Melbourne Center】已到达。操作员【MEL_RDC_Scanner_15】 。'),
    track(daysAgo(19, '14:36:29'), '【Melbourne Center】包裹已转交至【Australia Post】进行承运。操作员【Mel_FrontDesk_1】'),
    track(daysAgo(14), '【Melbourne Center】已到达。操作员【AU POST Australia Post】 。'),
    track(daysAgo(12), '【Melbourne Center】登记问题件[自提]AWAITING COLLECTION AT AUSTRALIA POST, 操作员【Australia Post】。', 'problem'),
    track(daysAgo(7), '包裹正在处理中。'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '暂无异常', confidence: 0.8 }), facts)

  assert.equal(facts.activeResponsibilityOwner, 'external_carrier')
  assert.equal(facts.activeExternalCarrierName, 'Australia Post')
  assert.equal(facts.activeSegmentStatus, 'external_carrier')
  assert.equal(guarded.lossScope, '3PL丢件')
  assert.equal(guarded.exceptionCategoryId, '')
  assert.equal(guarded.needsReview, false)
  assert.equal(guarded.appliedDecisionRuleId, 'external_carrier_stale_is_3pl_loss')
})

test('JD 3PL 转交后外部承运派送中断更超过 7 天判定 3PL 丢件', () => {
  const handoffTime = daysAgo(43, '16:01:44')
  const latestTime = daysAgo(12, '09:38:15')
  const facts = deriveTrackFacts([
    normalizeTrackEvent({
      time: handoffTime.replaceAll('-', '.'),
      content: '【Sydney Center】包裹已转交至【JD.COM AUSTRALIA PTY LTD】进行承运。操作员【SYD OPS4】',
    }),
    normalizeTrackEvent({
      time: daysAgo(40, '20:38:12').replaceAll('-', '.'),
      content: '【Sydney Center】已到达。操作员【JD AUS JD.COM AUSTRALIA PTY LTD】 。',
    }),
    normalizeTrackEvent({
      time: latestTime,
      trackType: 'delivery',
      trackStageTx: '派送',
      content: '【Coffs Harbour Station】包裹正在派送中(派件员: , )。操作员【JD AUS JD.COM AUSTRALIA PTY LTD】',
    }),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '需人工判断', reason: '模型保守判定', confidence: 0.8 }),
    facts
  )

  assert.equal(facts.activeResponsibilityOwner, 'external_carrier')
  assert.equal(facts.activeExternalCarrierName, 'JD.COM AUSTRALIA PTY LTD')
  assert.equal(facts.externalCarrierTransferTime, handoffTime)
  assert.equal(facts.lastEventTime, latestTime)
  assert.equal(guarded.lossScope, '3PL丢件')
  assert.equal(guarded.appliedDecisionRuleId, 'external_carrier_stale_is_3pl_loss')
})

test('非外部承运责任段不得接受模型误报的 3PL 丢件', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(8), '【ADL DS】包号[2603191734601]已到达。操作员【ADL-DC-Tong】 。'),
    track(daysAgo(7), '【ADL DS】派送任务已分配给派件员(派件员：ADL-JC-city-A,电话：***)，待派件员领取包裹。 操作员【cornerstone】'),
  ])
  const guarded = applyFactGuardrails(
    baseResult({ lossScope: '3PL丢件', reason: '模型误报 3PL', confidence: 0.9 }),
    facts
  )

  assert.equal(facts.activeResponsibilityOwner, 'company_warehouse')
  assert.equal(guarded.lossScope, '需人工判断')
  assert.equal(guarded.appliedDecisionRuleId, 'non_external_carrier_cannot_be_3pl_loss')
})

test('ADL 当前责任段真实扫描加分配取消循环仍判库内事实成立', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(8), '【ADL DS】包号[2603191734601]已到达。操作员【ADL-DC-Tong】 。'),
    track(daysAgo(7), '【ADL DS】派送任务已分配给派件员(派件员：ADL-JC-city-A,电话：***)，待派件员领取包裹。 操作员【cornerstone】'),
    track(daysAgo(7, '11:00:00'), '【ADL DS】包裹已取消分配给[ADL-JC-city-A]。操作员【ADL OP1】'),
    track(daysAgo(6), '【ADL DS】派送任务已分配给派件员(派件员：ADL-JC-city-B,电话：***)，待派件员领取包裹。 操作员【cornerstone】'),
    track(daysAgo(6, '11:00:00'), '【ADL DS】包裹已取消分配给[ADL-JC-city-B]。操作员【ADL OP1】'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'adelaide_ds')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.assignCancelLoopWithoutDispatch, true)
  assert.equal(normalizeSubType({ lossScope: '库内丢失', facts }), '扫描员丢失')
})

test('同城上游仓真实扫描可作为 DS 内部转发入库依据', () => {
  const inboundScanTime = daysAgo(8, '12:21:44')
  const facts = deriveTrackFacts([
    track(daysAgo(8, '12:21:14'), '【Adelaide Center】已揽收, 操作员【System】。'),
    track(inboundScanTime, '【Adelaide Center】已到达。操作员【ADL-DC-Tong】 。'),
    track(daysAgo(8, '12:21:45'), '【Adelaide Center】完成待转发件，目的地【ADL DS】。操作员【System】'),
    track(daysAgo(8, '12:21:46'), '【ADL DS】已到达。操作员【System】 。'),
    track(daysAgo(7, '09:14:11'), '【ADL DS】派送任务已分配给派件员(派件员：ADL-JC-city-A,电话：***)，待派件员领取包裹。 操作员【cornerstone】'),
    track(daysAgo(7, '09:53:27'), '【ADL DS】包裹已取消分配给[ADL-JC-city-A]。操作员【ADL OP1】'),
    track(daysAgo(6, '09:05:41'), '【ADL DS】派送任务已分配给派件员(派件员：ADL-JC-city-A,电话：***)，待派件员领取包裹。 操作员【cornerstone】'),
    track(daysAgo(6, '09:31:42'), '【ADL DS】包裹已取消分配给[ADL-JC-city-A]。操作员【ADL OP1】'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'adelaide_ds')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, inboundScanTime)
  assert.equal(facts.inWarehouseBasis, `当前责任段上游同城仓真实操作员扫描（内部转发入库依据）（${inboundScanTime}）`)
  assert.equal(facts.assignCancelLoopWithoutDispatch, true)
  assert.equal(normalizeSubType({ lossScope: '库内丢失', facts }), '扫描员丢失')
})

test('当前责任段真实出库超 7 天且未回仓满足库外事实', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(9), '【ADL DS】包号[2603191734601]已到达。操作员【ADL-DC-Tong】 。'),
    track(daysAgo(8), '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)', 'delivery'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'adelaide_ds')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.lastDispatchHasReturn, false)
  assert.ok(facts.outWarehouseDaysDiff >= 7)
  assert.equal(normalizeSubType({ lossScope: '库外丢失', facts }), '快递员丢失')
})

test('派件员二次出库扫描不作为仓内真实扫描，且超 7 天未回仓强制归库外', () => {
  const dispatchTime = daysAgo(8, '09:53:51')
  const facts = deriveTrackFacts([
    track(daysAgo(9, '13:39:32'), '【ADL DS】已到达。操作员【System】 。'),
    track(
      dispatchTime,
      '【ADL DS】包裹正在派送中(派件员: ADL-city-003-VENKATA SRAVI TEJA SETTY, ***)。操作员【ADL-city-003-VENKATA SRAVI TEJA SETTY】',
      'delivery',
      '派送'
    ),
    track(daysAgo(2, '11:18:01'), '包裹正在处理中。'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库内丢失' }), facts)

  assert.equal(facts.hasRealOperatorScan, false)
  assert.equal(facts.lastDispatchedOutTime, dispatchTime)
  assert.equal(facts.lastDispatchHasReturn, false)
  assert.equal(guarded.lossScope, '库外丢失')
  assert.equal(guarded.exceptionCategoryId, '快递员丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'active_dispatch_out_overdue_is_out_warehouse_loss')
})

test('仓库自定义超时阈值会阻止未达阈值的库外丢失', () => {
  const baseFacts = deriveTrackFacts([
    track(daysAgo(9), '【ADL DS】包号[2603191734601]已到达。操作员【ADL-DC-Tong】 。'),
    track(daysAgo(8), '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)', 'delivery'),
  ])
  const facts: TrackFacts = { ...baseFacts, activeWarehouseLossTimeoutDays: 10 }
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库外丢失' }), facts)

  assert.equal(facts.outWarehouseDaysDiff < facts.activeWarehouseLossTimeoutDays, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.appliedDecisionRuleId, 'out_warehouse_loss_threshold_not_met')
})

test('签收成功终态优先于库外超时归责', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(9, '13:39:32'), '【ADL DS】已到达。操作员【System】 。'),
    track(daysAgo(8, '09:53:51'), '【ADL DS】包裹正在派送中(派件员: ADL-city-003-VENKATA SRAVI TEJA SETTY, ***)。操作员【ADL-city-003-VENKATA SRAVI TEJA SETTY】', 'delivery', '派送'),
    track(daysAgo(7, '11:54:44'), '【ADL DS】签收成功，操作员【ADL-KAS-Parth Jagdishchandra】【View Proof】', '', '已签收'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库外丢失', reason: '模型误判库外超时' }), facts)

  assert.equal(facts.hasDeliveryCompletion, true)
  assert.equal(facts.deliveryCompletionTime, daysAgo(7, '11:54:44'))
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.appliedDecisionRuleId, 'delivery_completion_terminal')
})

test('仅 trackStageTx 命中已签收时仍识别为正常完结', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(9, '13:39:32'), '【ADL DS】已到达。操作员【System】 。'),
    track(daysAgo(8, '09:53:51'), '【ADL DS】包裹正在派送中。操作员【ADL-city-003】', 'delivery', '派送'),
    track(daysAgo(7, '11:54:44'), '【ADL DS】轨迹状态更新。操作员【ADL OP1】', '', '已签收'),
  ])

  assert.equal(facts.hasDeliveryCompletion, true)
  assert.equal(facts.deliveryCompletionTime, daysAgo(7, '11:54:44'))
})

test('已签收终态下阻断日志责任点不应反转为库外丢失', () => {
  const completionTime = daysAgo(7, '13:08:53')
  const interceptLogs: ScanInterceptLog[] = [
    {
      waybillNo: '3781057901749',
      scanUserCode: 'D21029181701',
      scanUserName: 'ADL-DPAC-Sai Kumar',
      gmtIntercept: completionTime,
      operatorType: 'courier',
    },
  ]
  const facts = deriveTrackFacts(
    [
      track(daysAgo(8, '13:45:18'), '【ADL DS】已到达。操作员【System】 。'),
      track(daysAgo(7, '09:44:17'), '【ADL DS】包裹正在派送中(派件员: ADL-DPAC-Sai Kumar, ***)。操作员【ADL-DPAC-Sai Kumar】', 'delivery', '派送中'),
      track(completionTime, '【ADL DS】签收成功，操作员【ADL-DPAC-Sai Kumar】【View Proof】', '', '已签收'),
    ],
    interceptLogs
  )

  const guarded = applyFactGuardrails(
    baseResult({
      lossScope: '暂无异常',
      exceptionCategoryId: '',
      reason: '已签收/妥投（正常完结）',
      confidence: 0.99,
    }),
    facts
  )

  assert.equal(facts.hasDeliveryCompletion, true)
  assert.equal(facts.finalResponsibilityOwner, 'out_warehouse')
  assert.equal(facts.finalResponsibilityDaysDiff >= facts.activeWarehouseLossTimeoutDays, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.appliedDecisionRuleId, undefined)
})

test('同城上游仓扫描后出库时，库内起算不得被派件员账号污染', () => {
  const inboundScanTime = daysAgo(9, '13:39:30')
  const dispatchTime = daysAgo(8, '09:53:51')
  const facts = deriveTrackFacts([
    track(daysAgo(9, '13:39:00'), '【Adelaide Center】已揽收, 操作员【System】。'),
    track(inboundScanTime, '【Adelaide Center】已到达。操作员【ADL-DC-Lily】 。'),
    track(daysAgo(9, '13:39:31'), '【Adelaide Center】完成待转发件，目的地【ADL DS】。操作员【System】'),
    track(daysAgo(9, '13:39:32'), '【ADL DS】已到达。操作员【System】 。'),
    track(
      dispatchTime,
      '【ADL DS】包裹正在派送中(派件员: ADL-city-003-VENKATA SRAVI TEJA SETTY, ***)。操作员【ADL-city-003-VENKATA SRAVI TEJA SETTY】',
      'delivery',
      '派送'
    ),
    track(daysAgo(2, '11:18:01'), '包裹正在处理中。'),
  ])

  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, inboundScanTime)
  assert.equal(facts.lastDispatchedOutTime, dispatchTime)
  assert.equal(facts.inWarehouseStartSupersededByDispatch, true)
  assert.equal(normalizeSubType({ lossScope: '库外丢失', facts }), '快递员丢失')
})

test('出库后回站盘点会把当前库内起算重置到回仓节点', () => {
  const returnTime = daysAgo(2)
  const facts = deriveTrackFacts([
    track(daysAgo(10), '【ADL DS】包号[2603191734601]已到达。操作员【ADL-DC-Tong】 。'),
    track(daysAgo(9), '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)', 'delivery'),
    track(returnTime, '【ADL DS】已回到网点。操作员【ADL-DC-Tong】 。'),
  ])

  assert.equal(facts.lastDispatchHasReturn, true)
  assert.equal(facts.inWarehouseStartTime, returnTime)
  assert.equal(facts.inWarehouseStartSupersededByDispatch, false)
})

test('Melbourne 转运到 Adelaide 后按 Adelaide 仓库配置识别扫描员', () => {
  const arrivalTime = daysAgo(1)
  const facts = deriveTrackFacts([
    track(daysAgo(3), '【Melbourne Center】已装箱，目的地【Adelaide Center】。操作员【Mel_FrontDesk_1】'),
    track(arrivalTime, '【Adelaide Center】包号[2603191734601]已到达。操作员【ADL-DC-Tong】 。'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'adelaide_center')
  assert.equal(facts.activeWarehouseCityId, 'ADL')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, arrivalTime)
})

test('未知当前仓库配置时依赖扫描员的结论进入人工判断', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(8), '【Darwin Center】包号[2603191734601]已到达。操作员【DRW_Scanner_1】 。'),
  ])
  const guarded = applyFactGuardrails(baseResult(), facts)

  assert.equal(facts.unknownWarehouseInActiveSegment, true)
  assert.equal(guarded.lossScope, '需人工判断')
  assert.equal(guarded.appliedDecisionRuleId, 'unknown_active_warehouse_needs_review')
})

test('分配-取消循环无出库与出库后回仓再分配取消保持区分', () => {
  const noDispatchFacts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track('2024-01-02 10:00:00', '【ADL DS】派送任务已分配给派件员 D001'),
    track('2024-01-02 11:00:00', '【ADL DS】取消分配'),
    track('2024-01-03 10:00:00', '【ADL DS】派送任务已分配给派件员 D001'),
    track('2024-01-03 11:00:00', '【ADL DS】取消分配'),
  ])
  const afterReturnFacts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track('2024-01-02 10:00:00', '【ADL DS】包裹正在派送中', 'delivery'),
    track('2024-01-03 10:00:00', '【ADL DS】已回到网点'),
    track('2024-01-04 10:00:00', '【ADL DS】派送任务已分配给派件员 D001'),
    track('2024-01-04 11:00:00', '【ADL DS】取消分配'),
    track('2024-01-05 10:00:00', '【ADL DS】派送任务已分配给派件员 D001'),
    track('2024-01-05 11:00:00', '【ADL DS】取消分配'),
  ])

  assert.equal(noDispatchFacts.assignCancelLoopWithoutDispatch, true)
  assert.equal(afterReturnFacts.assignCancelLoopWithoutDispatch, false)
})

test('无真实操作员扫描时禁止库内丢失', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '【ADL DS】操作员【ADL-DC-Unload】 已盘点'),
    track('2024-01-02 10:00:00', '【ADL DS】派送任务已分配给派件员 D001'),
    track('2024-01-02 11:00:00', '【ADL DS】取消分配'),
    track('2024-01-03 10:00:00', '【ADL DS】派送任务已分配给派件员 D001'),
    track('2024-01-03 11:00:00', '【ADL DS】取消分配'),
  ])
  const guarded = applyFactGuardrails(baseResult(), facts)

  assert.equal(guarded.lossScope, '虚假转运')
  assert.equal(guarded.appliedDecisionRuleId, 'no_real_operator_cannot_be_in_warehouse_loss')
})

test('sorter 携带设备编码时视为仓内真实扫描记录', () => {
  const scanTime = daysAgo(8)
  const facts = deriveTrackFacts([
    track(scanTime, '【Sydney Center】已到达，包裹重量为【0kg】。操作员【sorter】 ,设备编码[AUS_S210312_01]'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '暂无异常' }), facts)

  assert.equal(facts.activeWarehouseHubId, 'sydney_placeholder')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, scanTime)
  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.exceptionCategoryId, '扫描员丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'active_in_warehouse_overdue_is_in_warehouse_loss')
})

test('sorter 未携带设备编码时不视为仓内真实扫描记录', () => {
  const facts = deriveTrackFacts([
    track(daysAgo(8), '【Sydney Center】已到达，包裹重量为【0kg】。操作员【sorter】'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库内丢失' }), facts)

  assert.equal(facts.activeWarehouseHubId, 'sydney_placeholder')
  assert.equal(facts.hasRealOperatorScan, false)
  assert.equal(facts.inWarehouseStartTime, null)
  assert.equal(guarded.lossScope, '需人工判断')
  assert.equal(guarded.appliedDecisionRuleId, 'company_warehouse_missing_basis_needs_review')
})

test('Sydney Center 分拣后转入 SYDN，按 SYDN 到达节点重置库内起算', () => {
  const sydnArrivalTime = daysAgo(8, '20:13:38')
  const facts = deriveTrackFacts([
    track(daysAgo(16, '23:57:58'), '已通过[OpenApi]成功下单', '', '订单提交'),
    track(daysAgo(8, '18:12:27'), '【Sydney Center】已揽收, 操作员【System】。', '', '已揽件'),
    track(daysAgo(8, '18:12:57'), '【Sydney Center】已到达，包裹重量为【0kg】。操作员【sorter】 ,设备编码[AUS_S210312_01]', '', '转运'),
    track(daysAgo(8, '19:15:21'), '【Sydney Center】已装箱，集包号[2605052095001]，目的地【SYDN】。操作员【SYD Warehouse21】', '', '转运'),
    track(daysAgo(8, '19:16:19'), '【Sydney Center】完成待转发件，目的地【SYDN】。操作员【SYD Warehouse5】', '', '转运'),
    track(daysAgo(8, '19:16:20'), '【Sydney Center】包裹已发往【SYDN】 ,包号 [2605052095001], 车辆任务编号【SYDCB202605070022】。操作员【SYD Warehouse5】', '', '转运'),
    track(daysAgo(8, '19:35:53'), '【Sydney Center】车辆[17LG]已出发。已封签【20260507003】， 车辆任务编号【SYDCB202605070022】操作员【SYD Warehouse5】', '', '转运'),
    track(sydnArrivalTime, '【SYDN】包号[2605052095001]已到达。操作员【NSYD W3】。', '', '派送'),
    track(daysAgo(7, '21:22:15'), '【SYDN】派送任务已分配给派件员(派件员：BPE-SN-1023-Tai Tuan NGUYEN,电话：***)，待派件员领取包裹。 操作员【cornerstone】', '', '派送'),
    track(daysAgo(7, '22:48:06'), '【SYDN】包裹已取消分配给[BPE-SN-1023-Tai Tuan NGUYEN]。操作员【SYDN OPS2】', '', '派送'),
    track(daysAgo(4, '22:08:26'), '【SYDN】派送任务已分配给派件员(派件员：MCU - 015 kwang -Puangkaew (SYDN),电话：***)，待派件员领取包裹。 操作员【cornerstone】', '', '派送'),
    track(daysAgo(3, '09:30:20'), '【SYDN】包裹已取消分配给[MCU - 015 kwang -Puangkaew (SYDN)]。操作员【SYDN OPS2】', '', '派送'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '暂无异常' }), facts)

  assert.equal(facts.activeWarehouseHubId, 'SYDN')
  assert.equal(facts.activeWarehouseCityId, 'SYD')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, sydnArrivalTime)
  assert.equal(facts.inWarehouseBasis, `正常轨迹悉尼分拣/内部转仓真实扫描责任点（${sydnArrivalTime}）`)
  assert.equal(facts.assignCancelLoopWithoutDispatch, true)
  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.exceptionCategoryId, '扫描员丢失')
  assert.equal(formatCurrentResponsibilityParty(facts), 'SYDN')
})

test('当前责任方根据责任段事实派生', () => {
  const inWarehouseFacts = deriveTrackFacts([
    track(daysAgo(8), '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
  ])
  const outWarehouseFacts = deriveTrackFacts([
    track(daysAgo(9), '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track(daysAgo(8), '【ADL DS】包裹正在派送中(派件员: ADL-JC-city-A,ID: D001,电话: ***)', 'delivery'),
  ])
  const externalFacts = deriveTrackFacts([
    track(daysAgo(2), '【Melbourne Center】已到达。操作员【MEL_RDC_Scanner_15】 。'),
    track(daysAgo(1), '【Melbourne Center】包裹已转交至【Australia Post】进行承运。操作员【Mel_FrontDesk_1】'),
  ])
  const transitFacts = deriveTrackFacts([
    track(daysAgo(2), '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track(daysAgo(1), '【ADL DS】已装箱，目的地【Melbourne Center】。操作员【ADL-FrontDesk】'),
  ])
  const returnFacts = deriveTrackFacts([
    track(daysAgo(2), '【】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
    track(daysAgo(1), '【ADL DS】已装箱，集包号[2605192882801]，目的地【TEMU-EI_LM_AUS】。操作员【ADL-前台】', '', '退件处理'),
  ])

  assert.equal(formatCurrentResponsibilityParty(inWarehouseFacts), 'ADL DS')
  assert.equal(formatCurrentResponsibilityParty(outWarehouseFacts), 'ADL DS')
  assert.equal(formatCurrentResponsibilityParty(externalFacts), 'Australia Post')
  assert.equal(formatCurrentResponsibilityParty(transitFacts), '转运至Melbourne Center')
  assert.equal(formatCurrentResponsibilityParty(returnFacts), 'ADL DS')
})

test('历史退返转移不应屏蔽后续新责任段的当前责任方', () => {
  const facts = deriveTrackFacts([
    track('2026-04-20 08:01:12', '【SYD CSP 7】包裹确认派送结束, 将按照商家反馈意见[退返商家]进行处理。', '', '退件处理'),
    track('2026-04-20 13:19:34', '【SYD CSP 7】已装箱，集包号[260420948701]，目的地【Sydney Center】。操作员【JCL 001】', '', '退件处理'),
    track('2026-04-25 07:37:41', '【Mel South East】已到达。操作员【MEL_RDC_Scanner_01】', '', '转运'),
    track('2026-04-30 16:05:54', '【Melbourne Center】已到达。操作员【MEL_RDC_Scanner_11】', '', '转运'),
    track('2026-05-18 14:58:46', '【Melbourne Center】已盘点，库位编号[MEL_RDC_012]。操作员【MEL_RDC_Scanner_08】', '', '派送'),
  ])

  assert.equal(facts.merchantReturnResponsibilityTransferred, true)
  assert.equal(facts.activeWarehouseName, 'Melbourne Center')
  assert.equal(formatCurrentResponsibilityParty(facts), 'Melbourne Center')
})

test('历史暂存不应屏蔽后续新责任段的当前责任方', () => {
  const facts = deriveTrackFacts([
    track('2026-04-24 08:02:10', '包裹确认派送结束, 将按照商家反馈意见[暂存]进行处理。', '', '退件处理'),
    track('2026-04-28 14:06:15', '【Sydney Center】已到达。操作员【SYD Warehouse21】', '', '转运'),
    track('2026-05-25 12:21:34', '【Sydney Center】已盘点，库位编号[T1]。操作员【SYD Warehouse21】', '', '退件处理'),
  ])

  assert.equal(facts.merchantStorageActive, true)
  assert.equal(facts.activeWarehouseName, 'Sydney Center')
  assert.equal(formatCurrentResponsibilityParty(facts), 'Sydney Center')
})

test('SYD CSP 7 使用 JCL warehouse 数字账号可识别为真实扫描员', () => {
  const profile = findWarehouseProfileByName('SYD CSP 7')
  const classification = classifyOperatorForWarehouse('JCL warehouse12', profile)

  assert.equal(profile?.hubId, 'syd_csp_7')
  assert.equal(classification, 'real')
})

test('Canberra Station 使用 CBR Warehouse 数字账号可识别为真实扫描员', () => {
  const profile = findWarehouseProfileByName('Canberra Station')
  const classification = classifyOperatorForWarehouse('CBR Warehouse3', profile)
  const facts = deriveTrackFacts([
    track(daysAgo(1), '【Canberra Station】已盘点，库位编号[CBR2-1]。操作员【CBR Warehouse3】'),
  ])

  assert.equal(profile?.hubId, 'canberra_station')
  assert.equal(classification, 'real')
  assert.equal(facts.activeWarehouseCityId, 'CBR')
  assert.equal(facts.activeWarehouseHubId, 'canberra_station')
  assert.equal(facts.hasRealOperatorScan, true)
})

test('SYD Warehouse 数字账号可作为 Sydney Center 内部转仓起算候选', () => {
  const transferTime = daysAgo(8, '19:35:53')
  const facts = deriveTrackFacts([
    track(daysAgo(8, '18:12:57'), '【Sydney Center】已到达，包裹重量为【0kg】。操作员【sorter】 ,设备编码[AUS_S210312_01]'),
    track(daysAgo(8, '19:16:20'), '【Sydney Center】包裹已发往【SYDN】 ,包号 [2605052095001], 车辆任务编号【SYDCB202605070022】。操作员【SYD Warehouse5】'),
    track(transferTime, '【Sydney Center】车辆[17LG]已出发。已封签【20260507003】， 车辆任务编号【SYDCB202605070022】操作员【SYD Warehouse21】'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'sydney_placeholder')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, transferTime)
  assert.equal(facts.inWarehouseBasis, `正常轨迹悉尼分拣/内部转仓真实扫描责任点（${transferTime}）`)
})

test('轨迹展示只在最后一条显示 trackStageTx', () => {
  const context = summarizeTracks([
    track('2026-05-14 16:22:28', '【SYDN】已盘点，库位编号[SYDN-7-2]。操作员【NSYD W3】', '', '派送'),
    track('2026-05-25 09:07:40', '【SYDN】包裹已取消分配给[SYD-BB-039-Tejaswi KOIRALA]。操作员【SYDN OPS2】', '', '派送'),
  ])

  assert.equal(context.includes('2026-05-14 16:22:28 | 派送 |'), false)
  assert.equal(context.includes('2026-05-25 09:07:40 | 派送 |'), true)
})

test('SYDN OPS 取消分配不作为真实扫描且不重置库内起算', () => {
  const arrivalTime = daysAgo(8, '20:13:38')
  const facts = deriveTrackFacts([
    track(arrivalTime, '【SYDN】包号[2605052095001]已到达。操作员【NSYD W3】。', '', '派送'),
    track(daysAgo(7, '21:22:15'), '【SYDN】派送任务已分配给派件员(派件员：BPE-SN-1023-Tai Tuan NGUYEN,电话：***)，待派件员领取包裹。 操作员【cornerstone】', '', '派送'),
    track(daysAgo(7, '22:48:06'), '【SYDN】包裹已取消分配给[BPE-SN-1023-Tai Tuan NGUYEN]。操作员【SYDN OPS2】', '', '派送'),
  ])

  assert.equal(facts.activeWarehouseHubId, 'SYDN')
  assert.equal(facts.hasRealOperatorScan, true)
  assert.equal(facts.inWarehouseStartTime, arrivalTime)
  assert.notEqual(facts.inWarehouseStartTime, daysAgo(7, '22:48:06'))
})

test('最近一次出库后已回仓时按最终责任点转为库内丢失', () => {
  const facts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
    track('2024-01-02 10:00:00', '【ADL DS】包裹正在派送中', 'delivery'),
    track('2024-01-03 10:00:00', '【ADL DS】已回到网点'),
  ])
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库外丢失' }), facts)

  assert.equal(facts.finalResponsibilityOwner, 'in_warehouse')
  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'intercept_updates_responsibility_start')
})

test('阻断日志只在库内和库外之间做交叉改判', () => {
  const interceptLogs: ScanInterceptLog[] = [
    {
      waybillNo: 'T1',
      scanUserCode: '10001',
      scanUserName: 'ADL Scanner',
      gmtIntercept: '2024-01-04 10:00:00',
      operatorType: 'scanner',
    },
  ]
  const facts = deriveTrackFacts(
    [
      track('2024-01-01 10:00:00', '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
      track('2024-01-02 10:00:00', '【ADL DS】包裹正在派送中', 'delivery'),
    ],
    interceptLogs
  )
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库外丢失' }), facts)

  assert.equal(guarded.lossScope, '库内丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'intercept_updates_responsibility_start')
})

test('阻断日志派送员晚于库内起算时以阻断时间作为库外起算重新判断 7 天', () => {
  const interceptLogs: ScanInterceptLog[] = [
    {
      waybillNo: 'T1',
      scanUserCode: 'D001',
      scanUserName: 'ADL Courier',
      gmtIntercept: daysAgo(8),
      operatorType: 'courier',
    },
  ]
  const facts = deriveTrackFacts(
    [track(daysAgo(12), '【ADL DS】操作员【ADL-DC-Tong】 已盘点')],
    interceptLogs
  )
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库内丢失' }), facts)

  assert.equal(facts.interceptAdjustedResponsibilityOwner, 'out_warehouse')
  assert.equal(facts.interceptAdjustedResponsibilityDaysDiff >= 7, true)
  assert.equal(guarded.lossScope, '库外丢失')
  assert.equal(guarded.exceptionCategoryId, '快递员丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'intercept_updates_responsibility_start')
  assert.equal(normalizeSubType({ lossScope: '库外丢失', facts }), '快递员丢失')
})

test('阻断日志派送员责任点晚于回仓时不被回仓记录否决', () => {
  const interceptTime = daysAgo(8, '12:00:00')
  const interceptLogs: ScanInterceptLog[] = [
    {
      waybillNo: 'T1',
      scanUserCode: 'D001',
      scanUserName: 'ADL Courier',
      gmtIntercept: interceptTime,
      operatorType: 'courier',
    },
  ]
  const facts = deriveTrackFacts(
    [
      track(daysAgo(14, '09:00:00'), '【ADL DS】操作员【ADL-DC-Tong】 已盘点'),
      track(daysAgo(13, '09:00:00'), '【ADL DS】包裹正在派送中', 'delivery'),
      track(daysAgo(12, '09:00:00'), '【ADL DS】已回到网点'),
      track(daysAgo(8, '10:00:00'), '【ADL DS】已下架。操作员【ADL-DC-Tong】'),
    ],
    interceptLogs
  )
  const guarded = applyFactGuardrails(baseResult({ lossScope: '暂无异常' }), facts)

  assert.equal(facts.lastDispatchHasReturn, true)
  assert.equal(facts.finalResponsibilityOwner, 'out_warehouse')
  assert.equal(facts.finalResponsibilityStartTime, interceptTime)
  assert.equal(guarded.lossScope, '库外丢失')
  assert.equal(guarded.exceptionCategoryId, '快递员丢失')
  assert.equal(guarded.appliedDecisionRuleId, 'intercept_updates_responsibility_start')
})

test('阻断日志更新最终起算后未满 7 天时不判库内或库外丢失', () => {
  const interceptLogs: ScanInterceptLog[] = [
    {
      waybillNo: 'T1',
      scanUserCode: 'D001',
      scanUserName: 'ADL Courier',
      gmtIntercept: daysAgo(3),
      operatorType: 'courier',
    },
  ]
  const facts = deriveTrackFacts(
    [track(daysAgo(12), '【ADL DS】操作员【ADL-DC-Tong】 已盘点')],
    interceptLogs
  )
  const guarded = applyFactGuardrails(baseResult({ lossScope: '库内丢失' }), facts)

  assert.equal(facts.interceptAdjustedResponsibilityOwner, 'out_warehouse')
  assert.equal(facts.interceptAdjustedResponsibilityDaysDiff < 7, true)
  assert.equal(guarded.lossScope, '暂无异常')
  assert.equal(guarded.appliedDecisionRuleId, 'intercept_updates_responsibility_start')
})

test('子类型归一只接受当前异常类型目录内的值或强事实推断', () => {
  const storageFacts = deriveTrackFacts([
    track('2024-01-01 10:00:00', '操作员【10001】 已盘点'),
    track('2024-01-02 10:00:00', '商家已反馈NDR处理意见[暂存]'),
  ])

  assert.equal(normalizeSubType({ lossScope: '暂无异常', subType: '快递员丢失' }), '')
  assert.equal(normalizeSubType({ lossScope: '暂无异常', facts: storageFacts }), '暂存')
  assert.equal(normalizeSubType({ lossScope: '暂无异常', facts: deriveTrackFacts([
    track('2024-01-01 10:00:00', '【ADL DS】退件已退返商家。操作员【ADL OP1】'),
  ]) }), '退返商家')
})

test('回归比对：异常类型与子类型均一致时通过', () => {
  const result = compareRegressionCase(
    { lossScope: '库内丢失', exceptionCategoryId: '扫描员丢失', reason: '超7天' },
    { lossScope: '库内丢失', exceptionCategoryId: '扫描员丢失' }
  )
  assert.equal(result.pass, true)
  assert.deepEqual(result.mismatches, [])
})

test('回归比对：异常类型不一致时失败', () => {
  const result = compareRegressionCase(
    { lossScope: '库内丢失', exceptionCategoryId: '', reason: '' },
    { lossScope: '暂无异常', exceptionCategoryId: '' }
  )
  assert.equal(result.pass, false)
  assert.deepEqual(result.mismatches, ['lossScope'])
})

test('回归比对：子类型不一致时失败', () => {
  const result = compareRegressionCase(
    { lossScope: '暂无异常', exceptionCategoryId: '暂存', reason: '' },
    { lossScope: '暂无异常', exceptionCategoryId: '退返商家' }
  )
  assert.equal(result.pass, false)
  assert.deepEqual(result.mismatches, ['exceptionCategoryId'])
})

test('模型漏返订单时按输入订单补齐需人工判断结果', () => {
  const results = parseOrderAnalyzeResults('{"results":[]}', [
    {
      orderNo: 'T1',
      tracks: [],
    },
  ])

  assert.equal(results.length, 1)
  assert.equal(results[0]?.orderNo, 'T1')
  assert.equal(results[0]?.lossScope, '需人工判断')
  assert.equal(results[0]?.confidence, 0)
  assert.equal(results[0]?.needsReview, true)
})

test('分析提示不向模型暴露仓库正则画像，操作员判断只读服务端预计算字段', () => {
  const { systemPromptBase, userPrompt } = prepareAnalyzeCategories({
    targets: [
      {
        orderNo: 'T1',
        tracks: [track(daysAgo(1), '【ADL DS】操作员【ADL-DC-Unload】 已盘点')],
      },
    ],
  })

  const fullPrompt = `${systemPromptBase}\n${userPrompt}`

  assert.equal(fullPrompt.includes('真实扫描员规则='), false)
  assert.equal(fullPrompt.includes('/^ADL-'), false)
  assert.match(fullPrompt, /模型禁止自行解析正则/)
  assert.match(fullPrompt, /真实操作员扫描记录: 否/)
})
