import assert from 'node:assert/strict'
import test from 'node:test'
import { buildContainerTransferCard } from './buildContainerTransferCard'
import type { TransferView } from '../containerManagement/transferService'

function transfer(overrides: Partial<TransferView> = {}): TransferView {
  return {
    id: 123,
    kind: 'LEND',
    status: 'CONFIRMED',
    fromAccountId: 'from-id',
    fromAccountName: '墨尔本一号仓',
    fromAccountIsExternal: false,
    toAccountId: 'to-id',
    toAccountName: '德威清关行',
    toAccountIsExternal: true,
    items: [{ containerType: 'BIG_BASKET', declaredQuantity: 12, receivedQuantity: null, settledQuantity: 12 }],
    declaredTotal: 12,
    receivedTotal: null,
    settledTotal: 12,
    occurredAt: '2026-09-01',
    note: null,
    receiverReportReason: null,
    receiverReportImageUrl: null,
    responseNote: null,
    senderAcceptedAt: null,
    respondedAt: '2026-09-01T02:00:00.000Z',
    proxyConfirmed: true,
    proxyEvidenceUrl: null,
    createdByUsername: 'alice',
    respondedByUsername: 'alice',
    createdAt: '2026-09-01T01:00:00.000Z',
    ...overrides,
  }
}

type Card = {
  header: { title: { content: string }; template: string }
  body: { elements: Array<{ content?: string }> }
}

test('代确认卡片的标题与配色和接收方本人确认区分开', () => {
  const card = buildContainerTransferCard({
    transfer: transfer(),
    event: 'proxyConfirmed',
    actorName: 'alice',
    sides: ['from'],
  }) as unknown as Card

  assert.equal(card.header.title.content, '容器流转 · 转出方按回单代确认收货')
  assert.equal(card.header.template, 'turquoise')
})

test('代确认卡片写明接收方无账号，并如实说明凭证有无', () => {
  const withoutEvidence = buildContainerTransferCard({
    transfer: transfer({ proxyEvidenceUrl: null }),
    event: 'proxyConfirmed',
    actorName: 'alice',
    sides: ['from'],
  }) as unknown as Card
  const noticeA = withoutEvidence.body.elements.map((el) => el.content ?? '').join('\n')
  assert.match(noticeA, /德威清关行 无系统账号/)
  assert.match(noticeA, /未附凭证/)

  const withEvidence = buildContainerTransferCard({
    transfer: transfer({ proxyEvidenceUrl: '/api/container/images/abc.jpg' }),
    event: 'proxyConfirmed',
    actorName: 'alice',
    sides: ['from'],
  }) as unknown as Card
  const noticeB = withEvidence.body.elements.map((el) => el.content ?? '').join('\n')
  assert.match(noticeB, /凭证见系统详情/)
})

test('接收方本人确认的卡片不带代确认说明', () => {
  const card = buildContainerTransferCard({
    transfer: transfer({ proxyConfirmed: false, toAccountIsExternal: false }),
    event: 'confirmed',
    actorName: 'bob',
    sides: ['from'],
  }) as unknown as Card

  assert.equal(card.header.title.content, '容器流转 · 接收方已确认收货')
  const body = card.body.elements.map((el) => el.content ?? '').join('\n')
  assert.doesNotMatch(body, /无系统账号/)
})
