/**
 * 协商时间线的事件构建。节点与文案对齐原 box-tracking 系统，
 * 数量一律来自 items 的 declared / received / settled 三个字段。
 */
import { containerTypeName, transferKindLabel } from '../../../containerManagement/constants'
import type { TransferDetail, TransferItem } from '../../../containerManagement/types'

export type NegotiationTimelineEvent =
  | {
      key: string
      sort: [number, number]
      kind: 'create' | 'report' | 'accept' | 'simple_confirm' | 'pending'
      when?: string
      title: string
      description: string
      /** 按品类展开的数量说明（与时间线正文搭配） */
      quantityLines?: string[]
      /** 差异申报原因，与时间线正文分开展示 */
      receiverReportReason?: string
      /** 差异申报证据图（可选） */
      receiverReportImageUrl?: string
      pendingLabel?: string
    }
  | {
      key: string
      sort: [number, number]
      kind: 'finalize'
      when: string
      title: string
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

/** 认可节点：与申报明细一致，无申报时退回申报数量 */
function acceptSettlementLines(detail: TransferDetail): string[] {
  const received = receiverReportQuantityLines(detail)
  return received.length > 0 ? received : declaredQuantityLines(detail)
}

/** 落表记账数量：与库存实际调整一致，0 的品类不展示 */
function bookedQuantityLines(detail: TransferDetail): string[] {
  const settled = detail.items.filter(
    (item) => item.settledQuantity !== null && item.settledQuantity > 0,
  )
  if (settled.length > 0) return settled.map((item) => line(item, item.settledQuantity ?? 0))
  return declaredQuantityLines(detail)
}

/** 同一请求内转出方认可并落表时，时间戳通常一致或极接近 */
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

  entries.push({
    key: 'create',
    sort: [createdMs, 0],
    kind: 'create',
    when: detail.createdAt,
    title: `发起${kindLabel}`,
    description: `${detail.fromAccountName} → ${detail.toAccountName}`,
    quantityLines: declaredQuantityLines(detail),
  })

  const reportLines = receiverReportQuantityLines(detail)
  const reasonTrimmed = detail.receiverReportReason?.trim()
  const hasReport = reportLines.length > 0 || (reasonTrimmed?.length ?? 0) > 0

  if (hasReport) {
    // 申报本身没有独立时间戳，排在认可/落表之前一格
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
      description:
        reportLines.length > 0
          ? '按品类申报实收如下。'
          : `实收 ${detail.receivedTotal ?? '—'} 件`,
      quantityLines: reportLines.length > 0 ? reportLines : undefined,
      receiverReportReason: reasonTrimmed || undefined,
      receiverReportImageUrl: detail.receiverReportImageUrl?.trim() || undefined,
    })
  }

  const hasDisputeTrail = hasReport || !!detail.senderAcceptedAt

  if (detail.senderAcceptedAt) {
    const mergedAcceptAndBook =
      detail.status === 'CONFIRMED' &&
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
        description: '转出方已认可按下列数量结算。',
        quantityLines: acceptSettlementLines(detail),
      })
    }
  }

  if (detail.respondedAt) {
    const ms = Date.parse(detail.respondedAt)
    if (detail.status === 'CONFIRMED' && !hasDisputeTrail) {
      const partial =
        detail.settledTotal !== null && detail.settledTotal !== detail.declaredTotal
      entries.push({
        key: 'simple-confirm',
        sort: [ms, 4],
        kind: 'simple_confirm',
        when: detail.respondedAt,
        title: '接收方确认收货',
        description: [
          partial
            ? '实收与申报合计不一致，已按实收合计记账。'
            : '与各品类申报一致，已全额记账。',
          detail.responseNote?.trim() ? ` ${detail.responseNote.trim()}` : '',
        ].join(''),
        quantityLines: declaredQuantityLines(detail),
      })
    } else if (detail.status === 'CONFIRMED' && hasDisputeTrail) {
      const mergedAcceptAndBook = sameMomentIso(detail.senderAcceptedAt, detail.respondedAt)
      entries.push({
        key: 'booked',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: mergedAcceptAndBook ? '转出方认可并完成落表' : '落表完成',
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
        description: noteText ?? '',
        tone: 'muted',
      })
    }
  }

  const tailSort: [number, number] = [Number.MAX_SAFE_INTEGER, 0]
  if (!detail.respondedAt && detail.status === 'DISPUTED') {
    entries.push({
      key: 'open-disputed',
      sort: tailSort,
      kind: 'pending',
      title: '进行中',
      pendingLabel: '协商中',
      description: '接收方可更新实收申报与原因说明，转出方可认可申报数量。',
    })
  } else if (!detail.respondedAt && detail.status === 'PENDING_RECEIVER') {
    entries.push({
      key: 'open-pending-receiver',
      sort: tailSort,
      kind: 'pending',
      title: '进行中',
      pendingLabel: '待接收方处理',
      description: '等待接收方确认收货或进行差异申报。',
    })
  }

  return entries.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1])
}

/** 节点圆形图标的描边与底色 */
export function timelineNodeClass(kind: NegotiationTimelineEvent['kind']): string {
  switch (kind) {
    case 'create':
      return 'border-sky-500/45 bg-sky-500/[0.08] text-sky-700'
    case 'report':
      return 'border-amber-500/45 bg-amber-500/[0.09] text-amber-800'
    case 'accept':
      return 'border-emerald-500/45 bg-emerald-500/[0.08] text-emerald-800'
    case 'simple_confirm':
      return 'border-teal-500/45 bg-teal-500/[0.08] text-teal-800'
    case 'finalize':
      return ''
    case 'pending':
      return 'border-[#2f8f87]/35 bg-[#2f8f87]/[0.06] text-[#2f8f87]'
    default:
      return 'border-slate-200 bg-slate-100 text-slate-500'
  }
}

/** 数量明细列表左侧的竖色条 */
export function quantityListBorderClass(ev: NegotiationTimelineEvent): string {
  switch (ev.kind) {
    case 'report':
      return 'border-amber-500/40'
    case 'create':
      return 'border-sky-500/35'
    case 'accept':
      return 'border-emerald-500/35'
    case 'simple_confirm':
      return 'border-teal-500/35'
    case 'finalize':
      if (ev.tone === 'success') return 'border-emerald-500/40'
      if (ev.tone === 'destructive') return 'border-rose-500/35'
      return 'border-slate-200'
    default:
      return 'border-slate-200'
  }
}
