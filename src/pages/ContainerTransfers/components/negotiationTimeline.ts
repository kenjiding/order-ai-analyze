/**
 * 协商时间线的事件构建。节点与文案对齐原 box-tracking 系统，
 * 数量一律来自 items 的 declared / received / settled 三个字段。
 */
import type { TFunction } from 'i18next'
import { transferKindNeedsReceiverConfirmation } from '../../../containerManagement/constants'
import type { TransferDetail, TransferItem } from '../../../containerManagement/types'

export type NegotiationTimelineEvent =
  | {
      key: string
      sort: [number, number]
      kind: 'create' | 'report' | 'accept' | 'simple_confirm' | 'pending'
      when?: string
      title: string
      statusLabel: string
      description: string
      quantityLines?: string[]
      receiverReportReason?: string
      evidenceImageUrl?: string
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

function line(t: TFunction<'container'>, item: TransferItem, quantity: number): string {
  return t('quantityLine', { type: t(`containerType.${item.containerType}`), count: quantity })
}

function declaredQuantityLines(t: TFunction<'container'>, detail: TransferDetail): string[] {
  return detail.items.map((item) => line(t, item, item.declaredQuantity))
}

function receiverReportQuantityLines(t: TFunction<'container'>, detail: TransferDetail): string[] {
  return detail.items
    .filter((item) => item.receivedQuantity !== null)
    .map((item) => line(t, item, item.receivedQuantity ?? 0))
}

function acceptSettlementLines(t: TFunction<'container'>, detail: TransferDetail): string[] {
  const received = receiverReportQuantityLines(t, detail)
  return received.length > 0 ? received : declaredQuantityLines(t, detail)
}

function bookedQuantityLines(t: TFunction<'container'>, detail: TransferDetail): string[] {
  const settled = detail.items.filter(
    (item) => item.settledQuantity !== null && item.settledQuantity > 0,
  )
  if (settled.length > 0) return settled.map((item) => line(t, item, item.settledQuantity ?? 0))
  return declaredQuantityLines(t, detail)
}

export function sameMomentIso(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  return Math.abs(Date.parse(a) - Date.parse(b)) < 3000
}

export function buildNegotiationTimelineEvents(
  detail: TransferDetail,
  t: TFunction<'container'>,
): NegotiationTimelineEvent[] {
  const entries: NegotiationTimelineEvent[] = []
  const createdMs = Date.parse(detail.createdAt)
  const noteText = detail.note?.trim()
  const kindLabel = t(`transferKind.${detail.kind}`)
  const needsConfirm = transferKindNeedsReceiverConfirmation(detail.kind)

  entries.push({
    key: 'create',
    sort: [createdMs, 0],
    kind: 'create',
    when: detail.createdAt,
    title: t('timeline.createTitle', { kind: kindLabel }),
    statusLabel: needsConfirm ? t('timeline.createPending') : t('timeline.createInstant'),
    description: `${detail.fromAccountName} → ${detail.toAccountName}`,
    quantityLines: declaredQuantityLines(t, detail),
  })

  const reportLines = receiverReportQuantityLines(t, detail)
  const reasonTrimmed = detail.receiverReportReason?.trim()
  const hasReport = reportLines.length > 0 || (reasonTrimmed?.length ?? 0) > 0

  if (hasReport) {
    let reportMs: number
    if (detail.senderAcceptedAt) reportMs = Date.parse(detail.senderAcceptedAt) - 1
    else if (detail.respondedAt) reportMs = Date.parse(detail.respondedAt) - 1
    else reportMs = createdMs + 1

    entries.push({
      key: 'report',
      sort: [reportMs, 1],
      kind: 'report',
      when: new Date(reportMs).toISOString(),
      title: t('timeline.reportTitle'),
      statusLabel: t('timeline.reportStatus'),
      description:
        reportLines.length > 0
          ? t('timeline.reportDescLines')
          : t('timeline.reportDescTotal', { total: detail.receivedTotal ?? '—' }),
      quantityLines: reportLines.length > 0 ? reportLines : undefined,
      receiverReportReason: reasonTrimmed || undefined,
      evidenceImageUrl: detail.receiverReportImageUrl?.trim() || undefined,
      evidenceLabel: t('timeline.reportEvidence'),
    })
  }

  const hasDisputeTrail = hasReport || !!detail.senderAcceptedAt
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
        title: t('timeline.acceptTitle'),
        statusLabel: t('timeline.acceptStatus'),
        description: t('timeline.acceptDesc'),
        quantityLines: acceptSettlementLines(t, detail),
      })
    }
  }

  if (detail.respondedAt) {
    const ms = Date.parse(detail.respondedAt)
    if (bookedOnce && !hasDisputeTrail) {
      const partial =
        detail.settledTotal !== null && detail.settledTotal !== detail.declaredTotal
      const actor = detail.respondedByUsername?.trim()
      entries.push({
        key: 'simple-confirm',
        sort: [ms, 4],
        kind: 'simple_confirm',
        when: detail.respondedAt,
        title: detail.proxyConfirmed ? t('timeline.proxyConfirmTitle') : t('timeline.receiverConfirmTitle'),
        statusLabel: t('timeline.confirmedStatus'),
        description: [
          detail.proxyConfirmed
            ? t('timeline.proxyConfirmDesc', {
                to: detail.toAccountName,
                actor: actor
                  ? t('timeline.proxyConfirmDescActor', { name: actor })
                  : t('timeline.proxyConfirmDescStaff'),
              })
            : partial
              ? t('timeline.partialConfirmDesc')
              : t('timeline.fullConfirmDesc'),
          detail.responseNote?.trim() ? ` ${detail.responseNote.trim()}` : '',
        ].join(''),
        quantityLines: declaredQuantityLines(t, detail),
        evidenceImageUrl: detail.proxyConfirmed
          ? detail.proxyEvidenceUrl?.trim() || undefined
          : undefined,
        evidenceLabel: t('timeline.proxyEvidence'),
      })
    } else if (bookedOnce && hasDisputeTrail) {
      const mergedAcceptAndBook = sameMomentIso(detail.senderAcceptedAt, detail.respondedAt)
      entries.push({
        key: 'booked',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: mergedAcceptAndBook ? t('timeline.bookedMergedTitle') : t('timeline.bookedTitle'),
        statusLabel: t('timeline.bookedStatus'),
        description: [t('timeline.bookedDesc'), noteText ? ` ${noteText}` : ''].join(''),
        quantityLines: bookedQuantityLines(t, detail),
        tone: 'success',
      })
    } else if (detail.status === 'CANCELLED') {
      entries.push({
        key: 'cancelled',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: t('timeline.cancelledTitle', { kind: kindLabel }),
        statusLabel: t('timeline.cancelledStatus'),
        description: noteText ?? t('timeline.cancelledDesc'),
        tone: 'muted',
      })
    } else {
      entries.push({
        key: 'responded-other',
        sort: [ms, 5],
        kind: 'finalize',
        when: detail.respondedAt,
        title: t('timeline.respondedTitle'),
        statusLabel: t('timeline.respondedStatus'),
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
      title: t('timeline.voidedTitle'),
      statusLabel: t('timeline.voidedStatus'),
      description: [
        t('timeline.voidedDesc', {
          actor: actor ? t('timeline.voidedDescActor', { name: actor }) : t('timeline.voidedDescAdmin'),
        }),
        detail.voidedReason?.trim()
          ? t('timeline.voidedReasonPrefix', { reason: detail.voidedReason.trim() })
          : '',
      ].join(''),
      quantityLines: bookedQuantityLines(t, detail),
      tone: 'destructive',
    })
  }

  const tailSort: [number, number] = [Number.MAX_SAFE_INTEGER, 0]
  if (!detail.respondedAt && detail.status === 'DISPUTED') {
    entries.push({
      key: 'open-disputed',
      sort: tailSort,
      kind: 'pending',
      title: t('timeline.pendingTitle'),
      statusLabel: t('timeline.pendingDisputed'),
      pendingLabel: t('timeline.pendingDisputed'),
      description: t('timeline.pendingDisputedDesc'),
    })
  } else if (!detail.respondedAt && detail.status === 'PENDING_RECEIVER') {
    entries.push({
      key: 'open-pending-receiver',
      sort: tailSort,
      kind: 'pending',
      title: t('timeline.pendingTitle'),
      statusLabel: t('timeline.pendingReceiver'),
      pendingLabel: t('timeline.pendingReceiver'),
      description: t('timeline.pendingReceiverDesc'),
    })
  }

  return entries.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1])
}

export type TimelineTone =
  | 'create'
  | 'report'
  | 'accept'
  | 'confirm'
  | 'booked'
  | 'cancelled'
  | 'neutral'
  | 'pending'

export function timelineTone(ev: NegotiationTimelineEvent, t: TFunction<'container'>): TimelineTone {
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
      return ev.statusLabel === t('timeline.cancelledStatus') ? 'cancelled' : 'neutral'
  }
}
