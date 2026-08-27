import { Fragment, type ReactNode } from 'react'
import {
  AlertTriangle,
  BrainCircuit,
  Clock,
  Inbox,
  Loader2,
  MessageSquare,
  Package,
  Timer,
  TriangleAlert,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useVendorSnapshotTranslation } from '../../../i18n/hooks'
import { WaybillListPopover } from '../../../components/WaybillPopover'
import type { VendorSnapshotDriver, VendorSnapshotVendor } from '../vendorSnapshotStorage'
import type { VendorRankingResult } from '../../../../shared/vendorAnalysis/rankingScore'
import { VendorRankPlate } from './VendorRankPlate'

/* eslint-disable react-refresh/only-export-components -- 组件与 vendorSectionId/toneClasses 工具需同文件导出 */

/**
 * 供应商日报的渲染组件：由 VendorSnapshotPage（内部截图落地页）与
 * VendorPortalPage（外部供应商分享链接页）共享。
 * 渲染输入为自包含的 VendorSnapshotVendor 切片，不依赖 store / 权限。
 */

// ── Color utilities ────────────────────────────────────────────────────

export type ColorTone = 'green' | 'amber' | 'red' | 'muted'

export function toneClasses(tone: ColorTone) {
  if (tone === 'green') return {
    value: 'text-emerald-500',
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  }
  if (tone === 'amber') return {
    value: 'text-amber-500',
    badge: 'bg-amber-50 border-amber-200 text-amber-700',
  }
  if (tone === 'red') return {
    value: 'text-rose-500',
    badge: 'bg-rose-50 border-rose-200 text-rose-700',
  }
  return {
    value: 'text-slate-300',
    badge: 'bg-slate-50 border-slate-200 text-slate-400',
  }
}

function complaintTone(rate: number): ColorTone {
  if (rate >= 0.0003) return 'red'
  if (rate >= 0.00025) return 'amber'
  return 'green'
}

function before11Tone(rate: number | null): ColorTone {
  if (rate == null) return 'muted'
  if (rate >= 0.99) return 'green'
  if (rate >= 0.95) return 'amber'
  return 'red'
}

function dispatch24hTone(text: string | null): ColorTone {
  if (!text) return 'muted'
  const pct = parseFloat(text.replace('%', ''))
  if (isNaN(pct)) return 'muted'
  if (pct >= 95) return 'green'
  if (pct >= 92) return 'amber'
  return 'red'
}

function pendingTone(count: number): ColorTone {
  if (count === 0) return 'green'
  if (count <= 3) return 'amber'
  return 'red'
}

function driverDispatchTone(rate: number | null): ColorTone {
  if (rate == null) return 'muted'
  if (rate >= 0.95) return 'green'
  if (rate >= 0.92) return 'amber'
  return 'red'
}

// ── Metric visibility ─────────────────────────────────────────────────

/**
 * 可选指标的显隐开关（key 对应 metricsRegistry）。所有指标均可自由取消，没有强制常开项。
 * enabledMetricKeys 未传 → 全部渲染：老快照 / 老日报（无勾选集合字段）保持改造前的完整版式。
 */
type MetricFlags = {
  vendorBefore11: boolean
  vendorDispatch24h: boolean
  vendorComplaintRate: boolean
  unprocessed: boolean
  vendorLongTail: boolean
  driverTodayPickup: boolean
  driverDispatch24h: boolean
  driverBefore11: boolean
  returnWarning: boolean
  driverLongTail: boolean
}

function resolveMetricFlags(enabled?: ReadonlySet<string>): MetricFlags {
  return {
    vendorBefore11: enabled?.has('vendor.before11ExitRate') ?? true,
    vendorDispatch24h: enabled?.has('vendor.dispatch24h') ?? true,
    vendorComplaintRate: enabled?.has('vendor.complaintRate') ?? true,
    unprocessed: enabled?.has('vendor.unprocessedTickets') ?? true,
    vendorLongTail: enabled?.has('vendor.longTail') ?? true,
    driverTodayPickup: enabled?.has('driver.todayPickup') ?? true,
    driverDispatch24h: enabled?.has('driver.dispatch24h') ?? true,
    driverBefore11: enabled?.has('driver.before11ExitRate') ?? true,
    returnWarning: enabled?.has('driver.returnWarning') ?? true,
    driverLongTail: enabled?.has('driver.longTail') ?? true,
  }
}

/** Tailwind 不能拼接动态类名，KPI 卡数量 → 桌面端列数用静态映射；所有指标可自由取消，数量可低至 0 */
const KPI_GRID_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
}

// ── KPI Card ──────────────────────────────────────────────────────────

type MetricAccent = 'blue' | 'violet' | 'rose' | 'orange' | 'teal'

const ACCENT_STYLES: Record<MetricAccent, { header: string; border: string; icon: string; label: string }> = {
  blue:   { header: 'bg-blue-100 border-blue-200',     border: 'border-slate-100', icon: 'text-blue-600',   label: 'text-blue-700'   },
  violet: { header: 'bg-violet-100 border-violet-200', border: 'border-slate-100', icon: 'text-violet-600', label: 'text-violet-700' },
  rose:   { header: 'bg-rose-100 border-rose-200',     border: 'border-slate-100', icon: 'text-rose-600',   label: 'text-rose-700'   },
  orange: { header: 'bg-orange-100 border-orange-200', border: 'border-slate-100', icon: 'text-orange-600', label: 'text-orange-700' },
  teal:   { header: 'bg-teal-100 border-teal-200',     border: 'border-slate-100', icon: 'text-teal-600',   label: 'text-teal-700'   },
}

/** PCS 工单工作台：落地页「未处理工单」数值跳转 */
const PCS_TICKET_WORKBENCH_URL = 'https://pcs.imile.com/#/PCSTicketWorkbench'

function KpiCard({
  label,
  dateNote,
  value,
  tone,
  sub,
  subTone,
  accent,
  icon: Icon,
}: {
  label: string
  dateNote?: string
  value: ReactNode
  tone: ColorTone
  sub?: string
  subTone?: 'warn' | 'ok' | 'muted'
  accent: MetricAccent
  icon: LucideIcon
}) {
  const { value: valueClass } = toneClasses(tone)
  const subClass =
    subTone === 'warn' ? 'text-rose-500 font-medium' :
    subTone === 'ok'   ? 'text-emerald-600 font-medium' :
                         'text-slate-400'
  const ac = ACCENT_STYLES[accent]
  return (
    <div className={`flex flex-col rounded-xl overflow-hidden border shadow-sm min-w-0 ${ac.border}`}>
      <div className={`flex items-start gap-2 px-4 py-3 border-b ${ac.header}`}>
        <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${ac.icon}`} aria-hidden />
        <div className="min-w-0">
          <span className={`text-[13px] font-bold leading-snug ${ac.label}`}>{label}</span>
          {dateNote && <div className="mt-0.5 text-[11px] font-medium text-slate-400 leading-snug">{dateNote}</div>}
        </div>
      </div>
      <div className="bg-white px-3 pt-2.5 pb-3 sm:px-4 sm:pt-3 sm:pb-4 flex flex-col flex-1">
        <span className={`text-[28px] sm:text-[34px] font-black leading-none tabular-nums ${valueClass}`}>{value}</span>
        {sub && <span className={`mt-3 text-[13px] leading-snug ${subClass}`}>{sub}</span>}
      </div>
    </div>
  )
}

// ── Driver mobile card (< md) ─────────────────────────────────────────

function DriverStatCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: ColorTone }) {
  const { value: valueClass } = toneClasses(tone)
  return (
    <div className="vs-stat-cell min-w-0">
      <div className="text-[11px] font-semibold text-slate-500 leading-snug">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums leading-none ${valueClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] text-slate-400 tabular-nums">{sub}</div> : null}
    </div>
  )
}

function DriverMobileCard({ driver, flags }: { driver: VendorSnapshotDriver; flags: MetricFlags }) {
  const { t } = useVendorSnapshotTranslation()
  const dTone = driverDispatchTone(driver.dispatchRate24h)
  const before11Rate = driver.before11TotalCount > 0 ? driver.before11OfdCount / driver.before11TotalCount : null
  const b11Tone = before11Tone(before11Rate)

  // 归班预警 / 长尾单共用一格：两者都启用时合并展示，只启用一个时单独展示
  const warnLabel = [
    flags.returnWarning ? t('driverTable.returnWarning') : null,
    flags.driverLongTail ? t('driverTable.longTail') : null,
  ].filter(Boolean).join(' / ')
  const warnValue = [
    flags.returnWarning ? String(driver.returnWarningCount) : null,
    flags.driverLongTail ? String(driver.longTailCount) : null,
  ].filter(Boolean).join(' / ')
  const warnTooltip = [
    flags.returnWarning ? t('driverTable.tooltip.returnWarning') : null,
    flags.driverLongTail ? t('driverTable.tooltip.longTail') : null,
  ].filter(Boolean).join(' / ')
  const warnNos = [
    ...(flags.returnWarning ? driver.returnWarningWaybillNos : []),
    ...(flags.driverLongTail ? driver.longTailWaybillNos : []),
  ]
  const warnActive =
    (flags.returnWarning && driver.returnWarningCount > 0) ||
    (flags.driverLongTail && driver.longTailCount > 0)

  return (
    <div className="vs-driver-card px-4 py-3.5">
      <div className="text-base font-semibold text-slate-800 leading-tight">
        {driver.courierName || driver.courierCode}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
        <span className="font-mono text-slate-400">{driver.courierCode}</span>
        {driver.routeCode ? (
          <>
            <span className="text-slate-300" aria-hidden>·</span>
            <span className="font-semibold text-indigo-600">{driver.routeCode}</span>
          </>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {flags.driverTodayPickup && (
          <WaybillListPopover nos={driver.ofdWaybillNos} title={t('driverTable.tooltip.pickup')} placement="top">
            <div className={driver.ofdWaybillNos.length > 0 ? 'cursor-help' : undefined}>
              <DriverStatCell
                label={t('driverTable.todayPickup')}
                value={String(driver.ofdCount)}
                tone="muted"
              />
            </div>
          </WaybillListPopover>
        )}
        {flags.driverBefore11 && (
          <WaybillListPopover nos={driver.before11UnmetWaybillNos} title={t('driverTable.tooltip.before11Unmet')} placement="top">
            <div className={driver.before11UnmetWaybillNos.length > 0 ? 'cursor-help' : undefined}>
              <DriverStatCell
                label={t('driverTable.before11ExitRate')}
                value={before11Rate != null ? `${(before11Rate * 100).toFixed(1)}%` : '-'}
                sub={driver.before11TotalCount > 0 ? `${driver.before11OfdCount}/${driver.before11TotalCount}` : undefined}
                tone={b11Tone}
              />
            </div>
          </WaybillListPopover>
        )}
        {flags.driverDispatch24h && (
          <WaybillListPopover nos={driver.dispatch24hUnmetWaybillNos} title={t('driverTable.tooltip.dispatch24hUnmet')} placement="top">
            <div className={driver.dispatch24hUnmetWaybillNos.length > 0 ? 'cursor-help' : undefined}>
              <DriverStatCell
                label={t('driverTable.dispatch24h')}
                value={
                  driver.dispatchRate24h != null
                    ? `${(driver.dispatchRate24h * 100).toFixed(1)}%`
                    : '-'
                }
                sub={
                  driver.totalDispatchCount > 0
                    ? `${driver.dispatch24hCount}/${driver.totalDispatchCount}`
                    : undefined
                }
                tone={dTone}
              />
            </div>
          </WaybillListPopover>
        )}
        {(flags.returnWarning || flags.driverLongTail) && (
          <WaybillListPopover nos={warnNos} title={warnTooltip} placement="top">
            <div className={warnNos.length > 0 ? 'cursor-help' : undefined}>
              <DriverStatCell
                label={warnLabel}
                value={warnValue}
                tone={warnActive ? 'amber' : 'muted'}
              />
            </div>
          </WaybillListPopover>
        )}
      </div>
    </div>
  )
}

// ── Driver Table (md+) ────────────────────────────────────────────────

function DriverRow({ driver, isOdd, flags }: { driver: VendorSnapshotDriver; isOdd: boolean; flags: MetricFlags }) {
  const { t } = useVendorSnapshotTranslation()
  const dTone = driverDispatchTone(driver.dispatchRate24h)
  const { value: dClass } = toneClasses(dTone)
  const before11Rate = driver.before11TotalCount > 0 ? driver.before11OfdCount / driver.before11TotalCount : null
  const b11Tone = before11Tone(before11Rate)
  const { value: b11Class } = toneClasses(b11Tone)
  const rowBg = isOdd ? 'bg-amber-50/40' : 'bg-white'

  return (
    <tr className={rowBg}>
      <td className="px-4 py-3.5 border-b border-slate-100">
        <div className="text-[17px] font-semibold text-slate-800 leading-tight">
          {driver.courierName || driver.courierCode}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
          <span className="font-mono text-slate-400">{driver.courierCode}</span>
          {driver.routeCode ? (
            <>
              <span className="text-slate-300" aria-hidden>
                ·
              </span>
              <span className="font-semibold tracking-wide text-indigo-600">{driver.routeCode}</span>
            </>
          ) : null}
        </div>
      </td>
      {flags.driverTodayPickup && (
        <td className="px-4 py-3.5 text-center border-b border-slate-100">
          <WaybillListPopover nos={driver.ofdWaybillNos} title={t('driverTable.tooltip.pickup')}>
            <span className={`text-[18px] font-bold tabular-nums text-slate-700${driver.ofdWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
              {driver.ofdCount}
            </span>
          </WaybillListPopover>
        </td>
      )}
      {flags.driverBefore11 && (
        <td className="px-4 py-3.5 text-center border-b border-slate-100">
          {driver.before11TotalCount > 0 ? (
            <div>
              <WaybillListPopover nos={driver.before11UnmetWaybillNos} title={t('driverTable.tooltip.before11Unmet')}>
                <span className={`text-[18px] font-black tabular-nums ${b11Class}${driver.before11UnmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                  {before11Rate != null ? `${(before11Rate * 100).toFixed(1)}%` : '-'}
                </span>
              </WaybillListPopover>
              <div className="text-[13px] text-slate-400 mt-0.5 tabular-nums">
                {driver.before11OfdCount}/{driver.before11TotalCount}
              </div>
            </div>
          ) : (
            <span className="text-[18px] text-slate-300">-</span>
          )}
        </td>
      )}
      {flags.driverDispatch24h && (
        <td className="px-4 py-3.5 text-center border-b border-slate-100">
          {driver.totalDispatchCount > 0 ? (
            <div>
              <WaybillListPopover nos={driver.dispatch24hUnmetWaybillNos} title={t('driverTable.tooltip.dispatch24hUnmet')}>
                <span className={`text-[18px] font-black tabular-nums ${dClass}${driver.dispatch24hUnmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                  {driver.dispatchRate24h != null
                    ? `${(driver.dispatchRate24h * 100).toFixed(1)}%`
                    : '-'}
                </span>
              </WaybillListPopover>
              <div className="text-[13px] text-slate-400 mt-0.5 tabular-nums">
                {driver.dispatch24hCount}/{driver.totalDispatchCount}
              </div>
            </div>
          ) : (
            <span className="text-[18px] text-slate-300">-</span>
          )}
        </td>
      )}
      {flags.returnWarning && (
        <td className="px-4 py-3.5 text-center border-b border-slate-100">
          {driver.returnWarningCount > 0 ? (
            <WaybillListPopover nos={driver.returnWarningWaybillNos} title={t('driverTable.tooltip.returnWarning')}>
              <span className={`inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[15px] font-black text-rose-600${driver.returnWarningWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                {driver.returnWarningCount}
              </span>
            </WaybillListPopover>
          ) : (
            <span className="inline-flex items-center justify-center rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-[15px] font-semibold text-slate-400">
              0
            </span>
          )}
        </td>
      )}
      {flags.driverLongTail && (
        <td className="px-4 py-3.5 text-center border-b border-slate-100">
          {driver.longTailCount > 0 ? (
            <WaybillListPopover nos={driver.longTailWaybillNos} title={t('driverTable.tooltip.longTail')}>
              <span className={`inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[15px] font-black text-amber-600${driver.longTailWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                {driver.longTailCount}
              </span>
            </WaybillListPopover>
          ) : (
            <span className="inline-flex items-center justify-center rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-[15px] font-semibold text-slate-400">
              0
            </span>
          )}
        </td>
      )}
    </tr>
  )
}

// ── Vendor Section ────────────────────────────────────────────────────

/**
 * 区块 DOM id：按供应商单位键而不是 vendorCode——
 * ADL-City 和 ADL-Lu 共用编码，用编码会让两个区块 id 相同，截图时永远抓到同一个。
 */
export function vendorSectionId(supplierKey: string) {
  return `vendor-section-${supplierKey}`
}

/** 行内 **加粗**：AI 总结的 Markdown 子集，仅解析加粗，其余原样输出 */
function renderInlineBold(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part)
    return m ? <strong key={`${keyPrefix}-${i}`}>{m[1]}</strong> : <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
  })
}

/**
 * AI 总结的 Markdown 子集渲染：**加粗**小标题 + "- " 无序列表 + 段落。
 * 不引入 markdown 解析库，仅处理 prompt 里明确约定、飞书 markdown 组件也支持的这几种语法，
 * 保证截图页 / 供应商分享页与飞书推送消息的展示效果一致。
 */
function renderAiSummaryMarkdown(text: string): ReactNode {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const blocks: ReactNode[] = []
  let listBuffer: string[] = []
  const flushList = () => {
    if (!listBuffer.length) return
    const items = listBuffer
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i}>{renderInlineBold(item, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    )
    listBuffer = []
  }
  lines.forEach((line, idx) => {
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line)
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1])
      return
    }
    flushList()
    blocks.push(<p key={`p-${idx}`}>{renderInlineBold(line, `p-${idx}`)}</p>)
  })
  flushList()
  return blocks
}

function AiSummaryBlock({ summary, loading, loadingLabel }: { summary?: string; loading?: boolean; loadingLabel: string }) {
  if (!summary && !loading) return null
  return (
    <div className="mx-3 sm:mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-3 sm:px-4">
      <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" aria-hidden />
      {loading && !summary ? (
        <div className="flex items-center gap-2 text-[13px] text-indigo-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          <span>{loadingLabel}</span>
        </div>
      ) : (
        <div className="space-y-1.5 text-[13px] leading-relaxed text-indigo-900">{renderAiSummaryMarkdown(summary!)}</div>
      )}
    </div>
  )
}

const fmtShortDate = (s: string) => s.slice(5, 10).replace('-', '/')

export function VendorSection({
  vendor,
  index,
  aiSummary,
  aiSummaryLoading,
  aiSummaryLoadingLabel,
  before11Date,
  dispatch24hDate,
  complaintDateRange,
  enabledMetricKeys,
  ranking,
}: {
  vendor: VendorSnapshotVendor
  index: number
  aiSummary?: string
  aiSummaryLoading?: boolean
  aiSummaryLoadingLabel: string
  before11Date: string
  dispatch24hDate: string
  complaintDateRange: string
  /** 指标勾选集合；未传 → 全量渲染 */
  enabledMetricKeys?: ReadonlySet<string>
  /** 综合排名；由调用方现算后传入 */
  ranking?: VendorRankingResult
}) {
  const { t } = useVendorSnapshotTranslation()
  const flags = resolveMetricFlags(enabledMetricKeys)
  const rank = ranking
  const kpiCount =
    (flags.vendorBefore11 ? 1 : 0) +
    (flags.vendorDispatch24h ? 1 : 0) +
    (flags.vendorComplaintRate ? 1 : 0) +
    (flags.unprocessed ? 1 : 0) +
    (flags.vendorLongTail ? 1 : 0)
  const crTone = complaintTone(vendor.complaintRate)
  const b11Tone = before11Tone(vendor.before11ExitRate)
  const d24Tone = dispatch24hTone(vendor.dispatchRate24hText)
  const utTone = pendingTone(vendor.unprocessedTicketCount)
  const ltTone = pendingTone(vendor.longTailCount)

  const totalReturnWarning = vendor.drivers.reduce((s, d) => s + d.returnWarningCount, 0)
  const lowDispatchCount = vendor.drivers.filter(
    (d) => d.dispatchRate24h != null && d.dispatchRate24h < 0.92,
  ).length

  return (
    <div
      id={vendorSectionId(vendor.supplierKey)}
      className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-md"
    >
      {/* Vendor header */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-6 sm:py-5 bg-white border-b border-slate-100">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {rank && rank.poolSize >= 2 ? (
            <VendorRankPlate ranking={rank} />
          ) : (
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 shadow-sm">
              <span className="text-sm font-black text-white tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight break-words">
              {vendor.vendorName}
            </h2>
            <div className="text-[12px] sm:text-[13px] text-slate-400 mt-0.5 font-mono">{vendor.vendorCode}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:shrink-0">
          {flags.returnWarning && totalReturnWarning > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-600">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              {t('vendor.returnWarning', { count: totalReturnWarning })}
            </span>
          )}
          {lowDispatchCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-600">
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
              {t('vendor.lowDispatch', { count: lowDispatchCount })}
            </span>
          )}
          {flags.unprocessed && vendor.unprocessedTicketCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-600">
              <Package className="h-3 w-3 shrink-0" aria-hidden />
              {t('vendor.unprocessedTickets', { count: vendor.unprocessedTicketCount })}
            </span>
          )}
          {vendor.isDisabled && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-400">
              {t('vendor.pushDisabled')}
            </span>
          )}
        </div>
      </div>

      {/* KPI grid（所有指标均可取消，全部取消时不渲染） */}
      {kpiCount > 0 && (
        <div
          className={`grid grid-cols-2 md:grid-cols-3 ${KPI_GRID_COLS[kpiCount]} gap-2.5 sm:gap-3 p-3 sm:p-4`}
        >
          {flags.vendorBefore11 && (
            <KpiCard
              label={t('kpi.before11ExitRate')}
              dateNote={t('kpi.asOfDate', { date: fmtShortDate(before11Date) })}
              accent="blue"
              icon={Clock}
              value={vendor.before11ExitRate != null ? `${(vendor.before11ExitRate * 100).toFixed(1)}%` : '-'}
              tone={b11Tone}
              sub={
                vendor.before11ExitVolume != null && vendor.before11TotalReceived != null
                  ? t('kpi.pieces', { done: vendor.before11ExitVolume, total: vendor.before11TotalReceived })
                  : undefined
              }
              subTone="muted"
            />
          )}
          {flags.vendorDispatch24h && (
            <KpiCard
              label={t('kpi.dispatch24h')}
              dateNote={fmtShortDate(dispatch24hDate)}
              accent="violet"
              icon={Zap}
              value={vendor.dispatchRate24hText ?? '-'}
              tone={d24Tone}
              sub={
                vendor.notMet24hSignCount != null
                  ? vendor.notMet24hSignCount > 0
                    ? t('kpi.ticketsNotMet', { count: vendor.notMet24hSignCount })
                    : t('kpi.allMet')
                  : undefined
              }
              subTone={vendor.notMet24hSignCount != null ? (vendor.notMet24hSignCount > 0 ? 'warn' : 'ok') : 'muted'}
            />
          )}
          {flags.vendorComplaintRate && (
            <KpiCard
              label={t('kpi.complaintRate')}
              dateNote={complaintDateRange}
              accent="rose"
              icon={MessageSquare}
              value={`${(vendor.complaintRate * 100).toFixed(3)}%`}
              tone={crTone}
              sub={t('kpi.complaintSub', { complaints: vendor.complaintCount, waybills: vendor.waybillCount })}
              subTone="muted"
            />
          )}
          {flags.unprocessed && (
            <KpiCard
              label={t('kpi.unprocessedTickets')}
              accent="orange"
              icon={Inbox}
              value={
                <a
                  href={PCS_TICKET_WORKBENCH_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-2 underline-offset-4 hover:opacity-80"
                >
                  {vendor.unprocessedTicketCount}
                </a>
              }
              tone={utTone}
              sub={vendor.unprocessedTicketCount > 0 ? t('kpi.needsAction') : t('kpi.noPending')}
              subTone={vendor.unprocessedTicketCount > 0 ? 'warn' : 'ok'}
            />
          )}
          {flags.vendorLongTail && (
            <KpiCard
              label={t('kpi.longTail')}
              accent="teal"
              icon={Timer}
              value={String(vendor.longTailCount)}
              tone={ltTone}
              sub={vendor.longTailCount > 0 ? t('kpi.longTailFollowUp', { count: vendor.longTailCount }) : t('kpi.noLongTailItems')}
              subTone={vendor.longTailCount > 0 ? 'warn' : 'ok'}
            />
          )}
        </div>
      )}

      {/* AI summary */}
      <AiSummaryBlock summary={aiSummary} loading={aiSummaryLoading} loadingLabel={aiSummaryLoadingLabel} />

      {/* Driver table */}
      {vendor.drivers.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:px-6 sm:py-3 bg-amber-50/40 border-b border-amber-100/60">
            <Users className="h-4 w-4 text-slate-400 shrink-0" aria-hidden />
            <span className="text-[13px] font-bold text-slate-500 min-w-0">
              {t('driverTable.title')}
            </span>
            <span className="ml-auto shrink-0 text-[12px] text-slate-400">{t('driverTable.count', { count: vendor.drivers.length })}</span>
          </div>

          {/* Mobile: card list */}
          <div className="md:hidden divide-y divide-slate-100">
            {vendor.drivers.map((driver) => (
              <DriverMobileCard key={driver.courierCode} driver={driver} flags={flags} />
            ))}
          </div>

          {/* Tablet+: horizontal table */}
          <div className="vs-driver-scroll hidden md:block overflow-x-auto">
            <table className="w-full min-w-[880px]">
              <thead>
                <tr className="bg-amber-50/40">
                  <th className="px-4 py-3 text-left text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                    {t('driverTable.courier')}
                  </th>
                  {flags.driverTodayPickup && (
                    <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                      {t('driverTable.todayPickup')}
                    </th>
                  )}
                  {flags.driverBefore11 && (
                    <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                      {t('driverTable.before11ExitRate')}
                    </th>
                  )}
                  {flags.driverDispatch24h && (
                    <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                      {t('driverTable.dispatch24h')}
                    </th>
                  )}
                  {flags.returnWarning && (
                    <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                      {t('driverTable.returnWarning')}
                    </th>
                  )}
                  {flags.driverLongTail && (
                    <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                      {t('driverTable.longTail')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {vendor.drivers.map((driver, i) => (
                  <DriverRow key={driver.courierCode} driver={driver} isOdd={i % 2 === 1} flags={flags} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Metrics definition footer */}
      <MetricsDefinitionFooter />
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────

export function Legend() {
  const { t } = useVendorSnapshotTranslation()
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2 mb-6 sm:mb-8 px-0.5">
      <span className="text-xs font-bold text-slate-500">{t('legend.title')}</span>
      <div className="flex flex-wrap items-center gap-2">
        <LegendItem tone="green" label={t('legend.met')} />
        <LegendItem tone="amber" label={t('legend.warning')} />
        <LegendItem tone="red" label={t('legend.notMet')} />
      </div>
      <span className="text-[11px] text-slate-400 leading-relaxed sm:ml-0">
        {t('legend.thresholdHint')}
      </span>
    </div>
  )
}

function LegendItem({ tone, label }: { tone: ColorTone; label: string }) {
  const { badge } = toneClasses(tone)
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-[11px] font-bold ${badge}`}>
      {label}
    </span>
  )
}

// ── Metrics Legend ────────────────────────────────────────────────────

const METRIC_DEFINITION_KEYS = [
  {
    key: 'onTimePickup',
    accent: { text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-100', dot: 'bg-blue-400' },
  },
  {
    key: 'dispatch24h',
    accent: { text: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-100', dot: 'bg-violet-400' },
  },
  {
    key: 'complaintRate',
    accent: { text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-100', dot: 'bg-rose-400' },
  },
  {
    key: 'signedNotReceived',
    accent: { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-100', dot: 'bg-orange-400' },
  },
] as const

function MetricsDefinitionFooter() {
  const { t } = useVendorSnapshotTranslation()
  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-3 pt-3 pb-3.5 sm:px-4">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="h-px flex-1 bg-slate-100" />
        <span className="text-[11px] font-bold text-slate-400">{t('metrics.sectionTitle')}</span>
        <div className="h-px flex-1 bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {METRIC_DEFINITION_KEYS.map((item) => (
          <div
            key={item.key}
            className={`rounded-lg border ${item.accent.border} ${item.accent.bg} px-3 py-2 flex gap-2.5 items-start`}
          >
            <div className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${item.accent.dot}`} />
            <div className="min-w-0">
              <span className={`text-[14px] font-black ${item.accent.text}`}>{t(`metrics.${item.key}.name`)}</span>
              <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{t(`metrics.${item.key}.formula`)}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">{t('ranking.weightHint')}</p>
    </div>
  )
}
