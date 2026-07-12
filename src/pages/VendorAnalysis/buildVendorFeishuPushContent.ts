import { feishuImageMarker, feishuLinkMarker } from '../../components/FeishuLarkMdEditor'
import type { VendorRankingResult } from '../../../shared/vendorAnalysis/rankingScore'
import type { VendorSnapshotVendor } from './vendorSnapshotStorage'

/** 推送正文用的 vendor 级指标显隐（与 snapshotSections.resolveMetricFlags 口径一致） */
type VendorMetricFlags = {
  vendorBefore11: boolean
  vendorDispatch24h: boolean
  vendorComplaintRate: boolean
  unprocessed: boolean
  vendorLongTail: boolean
}

function resolveVendorMetricFlags(enabled?: ReadonlySet<string>): VendorMetricFlags {
  return {
    vendorBefore11: enabled?.has('vendor.before11ExitRate') ?? true,
    vendorDispatch24h: enabled?.has('vendor.dispatch24h') ?? true,
    vendorComplaintRate: enabled?.has('vendor.complaintRate') ?? true,
    unprocessed: enabled?.has('vendor.unprocessedTickets') ?? true,
    vendorLongTail: enabled?.has('vendor.longTail') ?? true,
  }
}

export type VendorFeishuPushLabels = {
  introTitleSuffix: string
  rankingHeading: string
  rankPrefix: string
  scoreUnit: string
  sampleInsufficient: string
  before11ExitRate: string
  dispatch24h: string
  complaintRate: string
  unprocessedTickets: string
  longTail: string
  pieces: (done: number, total: number) => string
  complaintSub: (complaints: number, waybills: number) => string
  ticketsNotMet: (count: number) => string
  shareLinkText: string
}

/** 排名 + 勾选中的供应商级指标摘要（lark_md / markdown 组件语法） */
export function buildVendorFeishuPushIntro(params: {
  vendorName: string
  vendor: VendorSnapshotVendor
  ranking?: VendorRankingResult
  enabledMetricKeys?: ReadonlySet<string>
  labels: VendorFeishuPushLabels
}): string {
  const { vendorName, vendor, ranking, enabledMetricKeys, labels } = params
  const flags = resolveVendorMetricFlags(enabledMetricKeys)
  const blocks: string[] = []

  blocks.push(`**${vendorName}** · ${labels.introTitleSuffix}`)

  if (ranking && ranking.poolSize >= 2) {
    const rankLine = [
      `**${labels.rankingHeading}**`,
      `${labels.rankPrefix}${ranking.rank} / ${ranking.poolSize}`,
      `· **${ranking.score.toFixed(1)}**${labels.scoreUnit}`,
    ].join(' ')
    blocks.push(rankLine)
    if (ranking.sampleInsufficient) {
      blocks.push(`_${labels.sampleInsufficient}_`)
    }
  }

  const metricLines: string[] = []

  if (flags.vendorBefore11 && vendor.before11ExitRate != null) {
    const pct = `${(vendor.before11ExitRate * 100).toFixed(1)}%`
    const sub =
      vendor.before11ExitVolume != null && vendor.before11TotalReceived != null
        ? labels.pieces(vendor.before11ExitVolume, vendor.before11TotalReceived)
        : null
    metricLines.push(`- ${labels.before11ExitRate}：**${pct}**${sub ? `（${sub}）` : ''}`)
  }

  if (flags.vendorDispatch24h && vendor.dispatchRate24hText) {
    const notMet =
      vendor.notMet24hSignCount != null && vendor.notMet24hSignCount > 0
        ? `（${labels.ticketsNotMet(vendor.notMet24hSignCount)}）`
        : ''
    metricLines.push(`- ${labels.dispatch24h}：**${vendor.dispatchRate24hText}**${notMet}`)
  }

  if (flags.vendorComplaintRate) {
    const pct = `${(vendor.complaintRate * 100).toFixed(2)}%`
    const sub = labels.complaintSub(vendor.complaintCount, vendor.waybillCount)
    metricLines.push(`- ${labels.complaintRate}：**${pct}**（${sub}）`)
  }

  if (flags.unprocessed) {
    metricLines.push(`- ${labels.unprocessedTickets}：**${vendor.unprocessedTicketCount}**`)
  }

  if (flags.vendorLongTail) {
    metricLines.push(`- ${labels.longTail}：**${vendor.longTailCount}**`)
  }

  if (metricLines.length > 0) {
    blocks.push(metricLines.join('\n'))
  }

  return blocks.join('\n\n')
}

/** 飞书富文本推送完整正文：摘要 → 截图占位 → 分享链接 */
export function buildVendorFeishuPushContent(params: {
  intro: string
  shareUrl?: string
  shareLinkText?: string
}): string {
  const parts: string[] = []
  const intro = params.intro.trim()
  if (intro) parts.push(intro)
  parts.push(feishuImageMarker(0))
  if (params.shareUrl && params.shareLinkText) {
    parts.push(feishuLinkMarker(params.shareUrl, params.shareLinkText, 'primary_filled'))
  }
  return parts.join('\n\n')
}
