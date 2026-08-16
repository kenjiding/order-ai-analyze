import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AnalysisRow } from './analysisTypes'
import {
  analysisRowFromExportRecord,
  analysisRowsFromExportRecords,
  toAnalysisExportRow,
} from './analysisExport'

function sampleRow(partial: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    orderNo: 'WB001',
    lossScope: '库内丢失',
    categoryName: '扫描员丢失',
    currentResponsibilityParty: 'Adelaide Center',
    reason: '超过阈值',
    confidence: '0.92',
    trackEvents: [],
    interceptLogs: [],
    status: 'done',
    needsReview: true,
    crossCheckedBy: 'deepseek',
    extraData: { summary: '嫌疑司机 D1', entries: [{ label: '司机', value: 'D1' }] },
    orderInfo: {
      merchantName: 'M',
      merchantCode: 'MC',
      totalWeight: '1',
      customerDeclaredValueAud: '1',
      declaredValueUsd: '1',
      consigneeRouteCode: 'R12',
    },
    latestResponsibility: {
      source: 'track',
      owner: 'in_warehouse',
      time: '2026-08-01 10:00:00',
      displayTime: '2026-08-01 10:00:00',
      person: '张三',
      action: '入库扫描',
      noOperationDays: 9,
    },
    ...partial,
  }
}

test('toAnalysisExportRow / analysisRowFromExportRecord 可回填可视化所需字段', () => {
  const exported = toAnalysisExportRow(sampleRow())
  const imported = analysisRowFromExportRecord(exported)
  assert.ok(imported)
  assert.equal(imported.orderNo, 'WB001')
  assert.equal(imported.lossScope, '库内丢失')
  assert.equal(imported.categoryName, '扫描员丢失')
  assert.equal(imported.orderInfo?.consigneeRouteCode, 'R12')
  assert.equal(imported.latestResponsibility?.person, '张三')
  assert.equal(imported.latestResponsibility?.noOperationDays, 9)
  assert.equal(imported.needsReview, true)
  assert.equal(imported.crossCheckedBy, 'deepseek')
  assert.equal(imported.extraData?.summary, '嫌疑司机 D1')
  assert.equal(imported.status, 'done')
})

test('analysisRowsFromExportRecords 按订单号去重并保留后出现的行', () => {
  const first = toAnalysisExportRow(sampleRow({ categoryName: '旧' }))
  const second = toAnalysisExportRow(sampleRow({ categoryName: '新' }))
  const rows = analysisRowsFromExportRecords([first, second])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.categoryName, '新')
})

test('缺少订单号的行被跳过', () => {
  const exported = toAnalysisExportRow(sampleRow({ orderNo: '' }))
  assert.equal(analysisRowFromExportRecord(exported), null)
})
