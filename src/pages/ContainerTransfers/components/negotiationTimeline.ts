/**
 * 协商时间线的事件构建。节点与文案对齐原 box-tracking 系统，
 * 数量一律来自 items 的 declared / received / settled 三个字段。
 */
import {
  containerTypeName,
  transferKindLabel,
  transferKindNeedsReceiverConfirmation,
} from '../../../containerManagement/constants'
import type { TransferDetail, TransferItem } from '../../../containerManagement/types'

export type NegotiationTimelineEvent =
  | {
      key: string
      sort: [number, number]
      kind: 'create' | 'report' | 'accept' | 'simple_confirm' | 'pending'
      when?: string
      title: string
      /** 该节点发生后流转所处的状态，时间线上用颜色标签醒目展示 */
      statusLabel: string
      description: string
      /** 按品类展开的数量说明（与时间线正文搭配） */
      quantityLines?: string[]
      /** 差异申报原因，与时间线正文分开展示 */
      receiverReportReason?: string
      /** 证据图（可选）：申报证据或代确认的线下回单 */
      evidenceImageUrl?: string
      /** 证据图的标题，不同节点叫法不同 */
      evidenceLabel?: string
      pendingLabel?: string
    }
  | {
      key: string
      sort: [number, number]
      kind: 'finalize'
      when: string
      title: string
      statusLabel: string
      description: string
      tone: 'success' | 'destructive' | 'muted'
      quantityLines?: string[]
    }

function line(item: TransferItem, quantity: number): string {
  return `${containerTypeName(item.containerType)} · ${quantity} 件`
}

function declaredQuantityLines(detail: TransferDetail): string[] {
  return detail.items.map((item) => line(item, item.declaredQuantity))
}

/** 接收方申报的实收明细；未申报时返回空数组 */
function receiverReportQuantityLines(detail: TransferDetail): string[] {
  return detail.items
    .filter((item) => item.receivedQuantity !== null)
    .map((item) => line(item, item.receivedQuantity ?? 0))
}

/** 认可节点：与接收方实收一致，未申报时退回转出方发出数 */
function acceptSettlementLines(detail: TransferDetail): string[] {
  const received = receiverReportQuantityLines(detail)
  return received.length > 0 ? received : declaredQuantityLines(detail)
}

/** 入账数量：与库存实际调整一致，0 的品类不展示 */
function bookedQuantityLines(detail: TransferDetail): string[] {
  const settled = detail.items.filter(
    (item) => item.settledQuantity !== null && item.settledQuantity > 0,
  )
  if (settled.length > 0) return settled.map((item) => line(item, item.settledQuantity ?? 0))
  return declaredQuantityLines(detail)
}

/** 同一请求内转出方认可并入账时，时间戳通常一致或极接近 */
export function sameMomentIso(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  return Math.abs(Date.parse(a) - Date.parse(b)) < 3000
}

export function buildNegotiationTimelineEvents(
  detail: TransferDetail,
): NegotiationTimelineEvent[] {
  const entries: NegotiationTimelineEvent[] = []
  const createdMs = Date.parse(detail.createdAt)
  const noteText = detail.note?.trim()
  const kindLabel = transferKindLabel[detail.kind] ?? detail.kind
  const needsConfirm = transferKindNeedsReceiverConfirmation(detail.kind)

  entries.push({
    key: 'create',
    sort: [createdMs, 0],
    kind: 'create',
    when: detail.createdAt,
    title: `发起${kindLabel}`,
    statusLabel: needsConfirm ? '待接收方确认' : '创建即记账',
    description: `${detail.fromAccountName} → ${detail.toAccountName}`,
    quantityLines: declaredQuantityLines(detail),
  })

  const reportLines = receiverReportQuantityLines(detail)
  const reasonTrimmed = detail.receiverReportReason?.trim()
  const hasReport = reportLines.length > 0 || (reasonTrimmed?.length ?? 0) > 0

  if (hasReport) {
    // 申报本身没有独立时间戳，排在认可/入账之前一格
    let reportMs: number
    if (detail.senderAcceptedAt) reportMs = Date.parse(detail.senderAcceptedAt) - 1
    else if (detail.respondedAt) reportMs = Date.parse(detail.respondedAt) - 1
    else reportMs = createdMs + 1

    entries.push({
      key: 'report',
      sort: [reportMs, 1],
      kind: 'report',
      when: new Date(reportMs).toISOString(),
      title: '接收方申报实收',
      statusLabel: '转入协商',
      description:
        reportLines.length > 0
          ? '按品类申报实收如下。'
          : `实收 ${detail.receivedTotal ?? '—'} 件`,
      quantityLines: reportLines.length > 0 ? reportLines : undefined,
      receiverReportReason: reasonTrimmed || undefined,
      evidenceImageUrl: detail.receiverReportImageUrl?.trim() || undefined,
      evidenceLabel: '申报证据',
    })
  }

  const hasDisputeTrail = hasReport || !!detail.senderAcceptedAt
  // 作废不抹掉入账这段历史：VOIDED 沿用 CONFIRMED 的节点，作废本身在末尾单独成一节
  const bookedOnce = detail.status === 'CONFIRMED' || detail.status === 'VOIDED'

  if (detail.senderAcceptedAt) {
    const mergedAcceptAndBook =
      bookedOnce &&
      hasDisputeTrail &&
      !!detail.respondedAt &&
      sameMomentIso(detail.senderAcceptedAt, detail.respondedAt)
    if (!mergedAcceptAndBook) {
      entries.push({
        key: 'accept',
        sort: [Date.parse(detail.senderAcceptedAt), 3],
        kind: 'accept',
        when: detail.senderAcceptedAt,
        title: '转出方认可结算',
        statusLabel: '已认可',
        description: '转出方已认可按下列数量结算。',
        quantityLines: acceptSettlementLines(detail),
      })
    }
  }

  if (detail.respondedAt) {
    const ms = Date.parse(detail.respondedAt)
    if (bookedOnce && !hasDisputeTrail) {
      const partial =
        detail.settledTotal !== null && detail.settledTotal !== detail.declaredTotal
      // 代确认没有接收方的任何动作，标题必须说清是谁按什么依据推的，否则会被读成对方确认了
      const actor = detail.respondedByUsername?.trim()
      entries.push({
        key: 'simple-confirm',
        sort: [ms, 4],
        kind: 'simple_confirm',
        when: detail.respondedAt,
        title: detail.proxyConfirmed ? '转出方按回单代确认' : '接收方确认收货',
        statusLabel: '已确认',
        description: [
          detail.proxyConfirmed
            ? `${detail.toAccountName} 无系统账号，由${actor ? ` ${actor} ` : '内部人员'}凭线下回单确认，已按各品类申报数量记账。`
            : partial
              ? '实收与申报合计不一致，已按实收合计记账。'
              : '与各品类申报一致，已全额记账。',
          detail.responseNote?.trim() ? ` ${detail.responseNote.trim()}` : '',
        ].join(''),
        quantityLines: declaredQuantityLines(detail),
        evidenceImageUrl: detail.proxyConfirmed
          ? detail.proxyEvidenceUrl?.trim() || undefined
          : undefined,
        evidenceLabel: '回单凭证',
      })
    } else if (bookedOnce && hasDisputeTrail) {
      const mergedAcceptAndBook = sameMomentIso(detail.senderAcceptedAt, detail.respondedAt)
      entries.push({
        key: 'booked',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: mergedAcceptAndBook ? '转出方认可并完成入账' : '入账完成',
        statusLabel: '已记账',
        description: ['库存已按下列各品类数量调整。', noteText ? ` ${noteText}` : ''].join(''),
        quantityLines: bookedQuantityLines(detail),
        tone: 'success',
      })
    } else if (detail.status === 'CANCELLED') {
      entries.push({
        key: 'cancelled',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: `${kindLabel}已取消`,
        statusLabel: '已取消',
        description: noteText ?? '双方库存未变更',
        tone: 'muted',
      })
    } else {
      entries.push({
        key: 'responded-other',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: '接收方操作',
        statusLabel: '已处理',
        description: noteText ?? '',
        tone: 'muted',
      })
    }
  }

  if (detail.status === 'VOIDED' && detail.voidedAt) {
    const actor = detail.voidedByUsername?.trim()
    entries.push({
      key: 'voided',
      sort: [Date.parse(detail.voidedAt), 6],
      kind: 'finalize',
      when: detail.voidedAt,
      title: '本单已作废',
      statusLabel: '已作废',
      description: [
        `由${actor ? ` ${actor} ` : '管理员'}作废，上面这笔入账已按下列数量反向冲回双方台账。`,
        detail.voidedReason?.trim() ? ` 原因：${detail.voidedReason.trim()}` : '',
      ].join(''),
      quantityLines: bookedQuantityLines(detail),
      tone: 'destructive',
    })
  }

  const tailSort: [number, number] = [Number.MAX_SAFE_INTEGER, 0]
  if (!detail.respondedAt && detail.status === 'DISPUTED') {
    entries.push({
      key: 'open-disputed',
      sort: tailSort,
      kind: 'pending',
      title: '进行中',
      statusLabel: '协商中',
      pendingLabel: '协商中',
      description: '接收方可更新实收数量与原因说明，转出方可认可接收方实收。',
    })
  } else if (!detail.respondedAt && detail.status === 'PENDING_RECEIVER') {
    entries.push({
      key: 'open-pending-receiver',
      sort: tailSort,
      kind: 'pending',
      title: '进行中',
      statusLabel: '待接收方处理',
      pendingLabel: '待接收方处理',
      description: '等待接收方确认收货或进行差异申报。',
    })
  }

  return entries.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1])
}

/** 时间线色调：每个节点一种颜色，状态标签、圆点、数量色条共用 */
export type TimelineTone =
  | 'create'
  | 'report'
  | 'accept'
  | 'confirm'
  | 'booked'
  | 'cancelled'
  | 'neutral'
  | 'pending'

export function timelineTone(ev: NegotiationTimelineEvent): TimelineTone {
  switch (ev.kind) {
    case 'create':
      return 'create'
    case 'report':
      return 'report'
    case 'accept':
      return 'accept'
    case 'simple_confirm':
      return 'confirm'
    case 'pending':
      return 'pending'
    case 'finalize':
      if (ev.tone === 'success') return 'booked'
      if (ev.tone === 'destructive') return 'cancelled'
      return ev.statusLabel === '已取消' ? 'cancelled' : 'neutral'
  }
}
