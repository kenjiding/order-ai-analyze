import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TransferDetail } from '../../../containerManagement/types'
import { i18n } from '../../../i18n'
import { buildNegotiationTimelineEvents } from './negotiationTimeline'

const t = i18n.getFixedT('zh-CN', 'container')

function detail(overrides: Partial<TransferDetail> = {}): TransferDetail {
  return {
    id: 123,
    kind: 'LEND',
    status: 'CONFIRMED',
    fromAccountId: 'from-id',
    fromAccountName: '墨尔本一号仓',
    fromAccountIsExternal: false,
    toAccountId: 'to-id',
    toAccountName: '德威清关行',
    toAccountIsExternal: false,
    items: [
      { containerType: 'BIG_BASKET', declaredQuantity: 20, receivedQuantity: null, settledQuantity: 20 },
    ],
    declaredTotal: 20,
    receivedTotal: null,
    settledTotal: 20,
    occurredAt: '2026-09-01',
    note: null,
    receiverReportReason: null,
    receiverReportImageUrl: null,
    responseNote: null,
    senderAcceptedAt: null,
    respondedAt: '2026-09-01T02:00:00.000Z',
    proxyConfirmed: false,
    proxyEvidenceUrl: null,
    createdByUsername: 'alice',
    respondedByUsername: 'bob',
    voidedAt: null,
    voidedReason: null,
    voidedByUsername: null,
    createdAt: '2026-09-01T01:00:00.000Z',
    ...overrides,
  }
}

const keys = (d: TransferDetail) => buildNegotiationTimelineEvents(d, t).map((ev) => ev.key)

test('作废不抹掉确认那一段历史，只在末尾追加作废节点', () => {
  const voided = detail({
    status: 'VOIDED',
    voidedAt: '2026-09-03T05:00:00.000Z',
    voidedReason: '录错了接收方',
    voidedByUsername: 'carol',
  })

  assert.deepEqual(keys(voided), ['create', 'simple-confirm', 'voided'])

  const last = buildNegotiationTimelineEvents(voided, t).at(-1)
  assert.equal(last?.statusLabel, t('timeline.voidedStatus'))
  assert.deepEqual(last?.quantityLines, [t('quantityLine', { type: t('containerType.BIG_BASKET'), count: 20 })])
  assert.match(last?.description ?? '', /carol/)
  assert.match(last?.description ?? '', /录错了接收方/)
})

test('协商后作废：认可与入账仍合并成一节，不会多出一个认可节点', () => {
  const sameMoment = '2026-09-02T03:00:00.000Z'
  const negotiated = {
    items: [
      { containerType: 'BIG_BASKET' as const, declaredQuantity: 20, receivedQuantity: 18, settledQuantity: 18 },
    ],
    receivedTotal: 18,
    settledTotal: 18,
    receiverReportReason: '少了 2 个',
    senderAcceptedAt: sameMoment,
    respondedAt: sameMoment,
  }

  assert.deepEqual(keys(detail({ ...negotiated, status: 'CONFIRMED' })), [
    'create',
    'report',
    'booked',
  ])
  assert.deepEqual(
    keys(
      detail({
        ...negotiated,
        status: 'VOIDED',
        voidedAt: '2026-09-03T05:00:00.000Z',
        voidedReason: '重复录入',
        voidedByUsername: 'carol',
      }),
    ),
    ['create', 'report', 'booked', 'voided'],
  )
})

test('未作废时不出现作废节点', () => {
  assert.ok(!keys(detail()).includes('voided'))
})
