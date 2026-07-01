import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BrainCircuit,
  Calendar,
  MapPin,
  TrendingUp,
  Clock,
  AlertTriangle,
  Users,
  Package,
  CheckCircle2,
  TriangleAlert,
  Send,
  CheckCheck,
  XCircle,
  Loader2,
  Zap,
  MessageSquare,
  Inbox,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import { toPng } from 'html-to-image'
import { LocaleSwitcher } from '../../components/I18n/LocaleSwitcher'
import { getDateTimeLocale } from '../../i18n'
import { useAppLocale, useVendorSnapshotTranslation } from '../../i18n/hooks'
import {
  loadVendorSnapshot,
  saveVendorSnapshot,
  type VendorSnapshotData,
  type VendorSnapshotDriver,
  type VendorSnapshotPushConfig,
  type VendorSnapshotVendor,
} from './vendorSnapshotStorage'
import { fetchVendorAiSummaries } from './vendorAnalysisApi'
import {
  buildVendorAiInputsFromSnapshot,
  hasAiSummariesForLocale,
  mergeAiSummariesForLocale,
  pickVendorAiSummary,
} from './vendorSnapshotAi'
import { postFeishuPushRichMessage } from '../PushNotifications/feishuWebhookTestApi'
import './vendorSnapshotPage.css'

// ── Mock data ──────────────────────────────────────────────────────────

const MOCK_DATA: VendorSnapshotData = {
  reportDate: '2026-06-27',
  stations: ['ADL01', 'ADL02', 'ADL03'],
  complaintDateRange: '06/16-06/22',
  before11Date: '2026-06-27',
  dispatch24hDate: '2026-06-26',
  generatedAt: new Date().toISOString(),
  webhookConfigs: [],
  vendors: [
    {
      vendorCode: 'TOPEX001',
      vendorName: 'Top Express',
      complaintRate: 0.0082,
      complaintCount: 3,
      waybillCount: 366,
      before11ExitRate: 0.986,
      before11ExitVolume: 284,
      before11TotalReceived: 288,
      dispatchRate24hText: '96.50%',
      notMet24hSignCount: 8,
      unprocessedTicketCount: 0,
      longTailCount: 2,
      isDisabled: false,
      drivers: [
        { courierCode: 'D001', courierName: 'Zhang Wei', routeCode: 'ADL-01-A', ofdCount: 48, before11OfdCount: 47, returnWarningCount: 0, dispatch24hCount: 44, totalDispatchCount: 45, dispatchRate24h: 0.978, longTailCount: 0 },
        { courierCode: 'D002', courierName: 'Li Ming', routeCode: 'ADL-01-B', ofdCount: 52, before11OfdCount: 49, returnWarningCount: 0, dispatch24hCount: 48, totalDispatchCount: 52, dispatchRate24h: 0.923, longTailCount: 1 },
        { courierCode: 'D003', courierName: 'Wang Fang', routeCode: 'ADL-02-A', ofdCount: 41, before11OfdCount: 36, returnWarningCount: 1, dispatch24hCount: 35, totalDispatchCount: 42, dispatchRate24h: 0.833, longTailCount: 1 },
        { courierCode: 'D004', courierName: 'Chen Jing', routeCode: 'ADL-02-B', ofdCount: 39, before11OfdCount: 39, returnWarningCount: 0, dispatch24hCount: 37, totalDispatchCount: 39, dispatchRate24h: 0.949, longTailCount: 0 },
      ],
    },
    {
      vendorCode: 'SWFT002',
      vendorName: 'Swift Delivery Co.',
      complaintRate: 0.0241,
      complaintCount: 9,
      waybillCount: 373,
      before11ExitRate: 0.943,
      before11ExitVolume: 215,
      before11TotalReceived: 228,
      dispatchRate24hText: '88.20%',
      notMet24hSignCount: 24,
      unprocessedTicketCount: 3,
      longTailCount: 7,
      isDisabled: false,
      drivers: [
        { courierCode: 'D011', courierName: 'Zhao Lei', routeCode: 'ADL-03-A', ofdCount: 55, before11OfdCount: 46, returnWarningCount: 2, dispatch24hCount: 38, totalDispatchCount: 48, dispatchRate24h: 0.792, longTailCount: 3 },
        { courierCode: 'D012', courierName: 'Sun Hui', routeCode: 'ADL-03-B', ofdCount: 47, before11OfdCount: 44, returnWarningCount: 0, dispatch24hCount: 42, totalDispatchCount: 47, dispatchRate24h: 0.894, longTailCount: 2 },
        { courierCode: 'D013', courierName: 'Liu Yang', routeCode: 'ADL-01-C', ofdCount: 38, before11OfdCount: 30, returnWarningCount: 1, dispatch24hCount: 26, totalDispatchCount: 36, dispatchRate24h: 0.722, longTailCount: 2 },
      ],
    },
  ],
}

// ── Color utilities ────────────────────────────────────────────────────

type ColorTone = 'green' | 'amber' | 'red' | 'muted'

function toneClasses(tone: ColorTone) {
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

// ── KPI Card ──────────────────────────────────────────────────────────

type MetricAccent = 'blue' | 'violet' | 'rose' | 'orange' | 'teal'

const ACCENT_STYLES: Record<MetricAccent, { header: string; border: string; icon: string; label: string }> = {
  blue:   { header: 'bg-blue-100 border-blue-200',     border: 'border-slate-100', icon: 'text-blue-600',   label: 'text-blue-700'   },
  violet: { header: 'bg-violet-100 border-violet-200', border: 'border-slate-100', icon: 'text-violet-600', label: 'text-violet-700' },
  rose:   { header: 'bg-rose-100 border-rose-200',     border: 'border-slate-100', icon: 'text-rose-600',   label: 'text-rose-700'   },
  orange: { header: 'bg-orange-100 border-orange-200', border: 'border-slate-100', icon: 'text-orange-600', label: 'text-orange-700' },
  teal:   { header: 'bg-teal-100 border-teal-200',     border: 'border-slate-100', icon: 'text-teal-600',   label: 'text-teal-700'   },
}

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
  value: string
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

function DriverMobileCard({ driver }: { driver: VendorSnapshotDriver }) {
  const { t } = useVendorSnapshotTranslation()
  const dTone = driverDispatchTone(driver.dispatchRate24h)
  const before11Rate = driver.ofdCount > 0 ? driver.before11OfdCount / driver.ofdCount : null
  const b11Tone = before11Tone(before11Rate)

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
        <DriverStatCell
          label={t('driverTable.todayPickup')}
          value={String(driver.ofdCount)}
          tone="muted"
        />
        <DriverStatCell
          label={t('driverTable.before11ExitRate')}
          value={before11Rate != null ? `${(before11Rate * 100).toFixed(1)}%` : '-'}
          sub={driver.ofdCount > 0 ? `${driver.before11OfdCount}/${driver.ofdCount}` : undefined}
          tone={b11Tone}
        />
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
        <DriverStatCell
          label={`${t('driverTable.returnWarning')} / ${t('driverTable.longTail')}`}
          value={`${driver.returnWarningCount} / ${driver.longTailCount}`}
          tone={driver.returnWarningCount > 0 || driver.longTailCount > 0 ? 'amber' : 'muted'}
        />
      </div>
    </div>
  )
}

// ── Driver Table (md+) ────────────────────────────────────────────────

function DriverRow({ driver, isOdd }: { driver: VendorSnapshotDriver; isOdd: boolean }) {
  const dTone = driverDispatchTone(driver.dispatchRate24h)
  const { value: dClass } = toneClasses(dTone)
  const before11Rate = driver.ofdCount > 0 ? driver.before11OfdCount / driver.ofdCount : null
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
      <td className="px-4 py-3.5 text-center border-b border-slate-100">
        <span className="text-[18px] font-bold tabular-nums text-slate-700">{driver.ofdCount}</span>
      </td>
      <td className="px-4 py-3.5 text-center border-b border-slate-100">
        {driver.ofdCount > 0 ? (
          <div>
            <span className={`text-[18px] font-black tabular-nums ${b11Class}`}>
              {before11Rate != null ? `${(before11Rate * 100).toFixed(1)}%` : '-'}
            </span>
            <div className="text-[13px] text-slate-400 mt-0.5 tabular-nums">
              {driver.before11OfdCount}/{driver.ofdCount}
            </div>
          </div>
        ) : (
          <span className="text-[18px] text-slate-300">-</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-center border-b border-slate-100">
        {driver.totalDispatchCount > 0 ? (
          <div>
            <span className={`text-[18px] font-black tabular-nums ${dClass}`}>
              {driver.dispatchRate24h != null
                ? `${(driver.dispatchRate24h * 100).toFixed(1)}%`
                : '-'}
            </span>
            <div className="text-[13px] text-slate-400 mt-0.5 tabular-nums">
              {driver.dispatch24hCount}/{driver.totalDispatchCount}
            </div>
          </div>
        ) : (
          <span className="text-[18px] text-slate-300">-</span>
        )}
      </td>
      <td className="px-4 py-3.5 text-center border-b border-slate-100">
        {driver.returnWarningCount > 0 ? (
          <span className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[15px] font-black text-rose-600">
            {driver.returnWarningCount}
          </span>
        ) : (
          <span className="inline-flex items-center justify-center rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-[15px] font-semibold text-slate-400">
            0
          </span>
        )}
      </td>
      <td className="px-4 py-3.5 text-center border-b border-slate-100">
        {driver.longTailCount > 0 ? (
          <span className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[15px] font-black text-amber-600">
            {driver.longTailCount}
          </span>
        ) : (
          <span className="inline-flex items-center justify-center rounded-full border border-slate-100 bg-slate-50 px-3 py-1 text-[15px] font-semibold text-slate-400">
            0
          </span>
        )}
      </td>
    </tr>
  )
}

// ── Vendor Section ────────────────────────────────────────────────────

export function vendorSectionId(vendorCode: string) {
  return `vendor-section-${vendorCode}`
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
        <p className="text-[13px] leading-relaxed text-indigo-900">{summary}</p>
      )}
    </div>
  )
}

const fmtShortDate = (s: string) => s.slice(5, 10).replace('-', '/')

function VendorSection({
  vendor,
  index,
  aiSummary,
  aiSummaryLoading,
  aiSummaryLoadingLabel,
  before11Date,
  dispatch24hDate,
  complaintDateRange,
}: {
  vendor: VendorSnapshotVendor
  index: number
  aiSummary?: string
  aiSummaryLoading?: boolean
  aiSummaryLoadingLabel: string
  before11Date: string
  dispatch24hDate: string
  complaintDateRange: string
}) {
  const { t } = useVendorSnapshotTranslation()
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
      id={vendorSectionId(vendor.vendorCode)}
      className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-md"
    >
      {/* Vendor header */}
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-6 sm:py-5 bg-white border-b border-slate-100">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
            <span className="text-sm font-black text-white tabular-nums">
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-tight break-words">
              {vendor.vendorName}
            </h2>
            <div className="text-[12px] sm:text-[13px] text-slate-400 mt-0.5 font-mono">{vendor.vendorCode}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {totalReturnWarning > 0 && (
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
          {vendor.unprocessedTicketCount > 0 && (
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

      {/* KPI grid */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 p-3 sm:p-4">
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
        <KpiCard
          label={t('kpi.unprocessedTickets')}
          accent="orange"
          icon={Inbox}
          value={String(vendor.unprocessedTicketCount)}
          tone={utTone}
          sub={vendor.unprocessedTicketCount > 0 ? t('kpi.needsAction') : t('kpi.noPending')}
          subTone={vendor.unprocessedTicketCount > 0 ? 'warn' : 'ok'}
        />
        <KpiCard
          label={t('kpi.longTail')}
          accent="teal"
          icon={Timer}
          value={String(vendor.longTailCount)}
          tone={ltTone}
          sub={vendor.longTailCount > 0 ? t('kpi.longTailFollowUp', { count: vendor.longTailCount }) : t('kpi.noLongTailItems')}
          subTone={vendor.longTailCount > 0 ? 'warn' : 'ok'}
        />
      </div>

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
              <DriverMobileCard key={driver.courierCode} driver={driver} />
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
                  <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                    {t('driverTable.todayPickup')}
                  </th>
                  <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                    {t('driverTable.before11ExitRate')}
                  </th>
                  <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                    {t('driverTable.dispatch24h')}
                  </th>
                  <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                    {t('driverTable.returnWarning')}
                  </th>
                  <th className="px-5 py-3 text-center text-[14px] font-bold text-slate-500 border-b border-slate-100 whitespace-nowrap">
                    {t('driverTable.longTail')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendor.drivers.map((driver, i) => (
                  <DriverRow key={driver.courierCode} driver={driver} isOdd={i % 2 === 1} />
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

// ── Summary strip ─────────────────────────────────────────────────────

function SummaryStrip({ vendors }: { vendors: VendorSnapshotVendor[] }) {
  const { t } = useVendorSnapshotTranslation()
  const activeVendors = vendors.filter((v) => !v.isDisabled)
  const totalUnprocessed = vendors.reduce((s, v) => s + v.unprocessedTicketCount, 0)
  const totalLongTail = vendors.reduce((s, v) => s + v.longTailCount, 0)
  const vendorsWithIssues = vendors.filter(
    (v) =>
      v.complaintRate >= 0.0003 ||
      (v.before11ExitRate != null && v.before11ExitRate < 0.95) ||
      (v.dispatchRate24hText != null && parseFloat(v.dispatchRate24hText) < 92),
  ).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
      <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
        <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.vendorCount')}</div>
        <div className="text-3xl sm:text-5xl font-black tabular-nums text-slate-800">{vendors.length}</div>
        <div className="mt-2 text-xs text-slate-400">{t('summary.pushEnabled', { count: activeVendors.length })}</div>
      </div>
      <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
        <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.unprocessedTickets')}</div>
        <div className={`text-3xl sm:text-5xl font-black tabular-nums ${totalUnprocessed > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
          {totalUnprocessed}
        </div>
        <div className={`mt-2 text-xs font-medium ${totalUnprocessed > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
          {totalUnprocessed > 0 ? t('summary.pendingAction') : t('summary.allClear')}
        </div>
      </div>
      <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
        <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.longTailTotal')}</div>
        <div className={`text-3xl sm:text-5xl font-black tabular-nums ${totalLongTail > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
          {totalLongTail}
        </div>
        <div className={`mt-2 text-xs font-medium ${totalLongTail > 0 ? 'text-amber-500' : 'text-emerald-600'}`}>
          {totalLongTail > 0 ? t('summary.itemsToFollowUp') : t('summary.noLongTail')}
        </div>
      </div>
      <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
        <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.alertVendors')}</div>
        <div className={`text-3xl sm:text-5xl font-black tabular-nums ${vendorsWithIssues > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
          {vendorsWithIssues}
        </div>
        <div className={`mt-2 text-xs font-medium ${vendorsWithIssues > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
          {vendorsWithIssues > 0 ? t('summary.vendorsNeedAttention', { count: vendorsWithIssues }) : t('summary.allMet')}
        </div>
      </div>
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────

function Legend() {
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
    </div>
  )
}

// ── Push helpers ──────────────────────────────────────────────────────

type VendorPushStatus = 'idle' | 'capturing' | 'pushing' | 'ok' | 'error'
type PushStateMap = Record<string, { status: VendorPushStatus; error?: string }>

// ── Push badge (overlaid on each vendor section while capturing/pushing) ──

function VendorPushBadge({ status, error }: { status: VendorPushStatus; error?: string }) {
  const { t } = useVendorSnapshotTranslation()
  if (status === 'idle') return null
  if (status === 'capturing' || status === 'pushing') {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[2px]">
        <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-white px-5 py-2.5 shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600" aria-hidden />
          <span className="text-sm font-semibold text-indigo-700">
            {status === 'capturing' ? t('push.capturing') : t('push.sending')}
          </span>
        </div>
      </div>
    )
  }
  if (status === 'ok') {
    return (
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 sm:px-3 shadow-sm max-w-[calc(100%-1.5rem)]">
        <CheckCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        <span className="text-[11px] font-bold text-emerald-700">{t('push.sent')}</span>
      </div>
    )
  }
  return (
    <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 sm:px-3 shadow-sm max-w-[calc(100%-1.5rem)]">
      <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />
      <span className="text-[11px] font-bold text-rose-700 truncate">{error ?? t('push.failed')}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────

const AUTO_PUSH = new URLSearchParams(
  typeof window !== 'undefined' ? window.location.search : '',
).has('autoPush')

export default function VendorSnapshotPage() {
  const { t } = useVendorSnapshotTranslation()
  const { locale } = useAppLocale()
  const [data, setData] = useState<VendorSnapshotData | null>(null)
  const [isMock, setIsMock] = useState(false)
  const [pushState, setPushState] = useState<PushStateMap>({})
  const [isPushing, setIsPushing] = useState(false)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const pushingRef = useRef(false)
  const autoPushFiredRef = useRef(false)

  useEffect(() => {
    const loaded = loadVendorSnapshot()
    if (loaded) {
      setData(loaded)
      setIsMock(false)
    } else {
      setData(MOCK_DATA)
      setIsMock(true)
    }
  }, [])

  // 切换语言时按需拉取对应语言的 AI 分析（已缓存则直接展示）
  useEffect(() => {
    if (!data || isMock || !data.vendors.length) return
    if (hasAiSummariesForLocale(data.aiSummaries, data.vendors, locale)) {
      setAiSummaryLoading(false)
      return
    }

    let cancelled = false
    setAiSummaryLoading(true)
    void (async () => {
      const result = await fetchVendorAiSummaries(
        buildVendorAiInputsFromSnapshot(data.vendors),
        locale,
      )
      if (cancelled) return
      if (result.ok) {
        setData((prev) => {
          if (!prev) return prev
          const aiSummaries = mergeAiSummariesForLocale(prev.aiSummaries, locale, result.data)
          const updated = { ...prev, aiSummaries }
          saveVendorSnapshot(updated)
          return updated
        })
      }
      setAiSummaryLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [data, isMock, locale])

  const handlePushAll = useCallback(async () => {
    if (!data || pushingRef.current) return
    const enabledConfigs = (data.webhookConfigs ?? []).filter(
      (c): c is VendorSnapshotPushConfig => !c.isDisabled && !!c.webhookUrl.trim(),
    )
    if (enabledConfigs.length === 0) return

    pushingRef.current = true
    setIsPushing(true)
    const initialState: PushStateMap = {}
    for (const c of enabledConfigs) initialState[c.vendorCode] = { status: 'idle' }
    setPushState(initialState)

    for (const config of enabledConfigs) {
      const vendor = data.vendors.find((v) => v.vendorCode === config.vendorCode)
      if (!vendor) continue

      const el = document.getElementById(vendorSectionId(config.vendorCode))
      if (!el) {
        setPushState((s) => ({ ...s, [config.vendorCode]: { status: 'error', error: t('push.sectionNotFound') } }))
        continue
      }

      setPushState((s) => ({ ...s, [config.vendorCode]: { status: 'capturing' } }))
      let dataUrl: string
      try {
        dataUrl = await toPng(el, { pixelRatio: 1.5, backgroundColor: '#ffffff' })
      } catch (err) {
        setPushState((s) => ({
          ...s,
          [config.vendorCode]: {
            status: 'error',
            error: t('push.captureFailed', {
              message: err instanceof Error ? err.message : t('push.unknownError'),
            }),
          },
        }))
        continue
      }

      setPushState((s) => ({ ...s, [config.vendorCode]: { status: 'pushing' } }))
      const result = await postFeishuPushRichMessage({
        pushScope: 'vendor-analysis',
        webhookUrl: config.webhookUrl,
        signingSecret: config.signingSecret ?? undefined,
        content: '',
        images: [dataUrl],
      })

      setPushState((s) => ({
        ...s,
        [config.vendorCode]: result.ok
          ? { status: 'ok' }
          : { status: 'error', error: 'error' in result ? result.error : t('push.failed') },
      }))
    }

    pushingRef.current = false
    setIsPushing(false)
  }, [data, t])

  // 检测 ?autoPush=1，页面渲染后自动触发推送
  useEffect(() => {
    if (!AUTO_PUSH || !data || isMock || autoPushFiredRef.current) return
    autoPushFiredRef.current = true
    const timer = setTimeout(() => { void handlePushAll() }, 800)
    return () => clearTimeout(timer)
  }, [data, isMock, handlePushAll])

  if (!data) return null

  const generatedAt = new Date(data.generatedAt)
  const timeStr = generatedAt.toLocaleString(getDateTimeLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const enabledConfigCount = (data.webhookConfigs ?? []).filter((c) => !c.isDisabled && c.webhookUrl.trim()).length
  const pushResults = Object.values(pushState)
  const successCount = pushResults.filter((s) => s.status === 'ok').length
  const errorCount = pushResults.filter((s) => s.status === 'error').length

  return (
    <div className="vendor-snapshot-page min-h-screen bg-white" id="vendor-snapshot-root">
      {/* Top accent bar */}
      <div className="h-1.5 bg-indigo-600" />

      <div className="max-w-[980px] mx-auto px-4 py-4 sm:px-6 sm:py-7">
        {/* Mock warning */}
        {isMock && (
          <div className="mb-4 sm:mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 sm:px-4">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <p className="text-sm text-amber-700 font-medium">
              {t('mockWarning')}
            </p>
          </div>
        )}

        {/* Header card */}
        <div className="mb-5 sm:mb-8 rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 sm:gap-6 items-start">
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] text-indigo-600 mb-2 sm:mb-3">
                {t('brand')}
              </div>
              <h1 className="text-2xl sm:text-[30px] font-black text-slate-900 leading-tight sm:leading-none">{t('title')}</h1>
              <div className="mt-3 sm:mt-4 flex flex-col min-[420px]:flex-row min-[420px]:flex-wrap gap-2 sm:gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{t('header.referenceDate')} {data.reportDate}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{t('header.complaintStats')} {data.complaintDateRange}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="break-all">{data.stations.join(' · ')}</span>
                </span>
              </div>
            </div>

            <div className="shrink-0 flex flex-col items-stretch gap-3 border-t border-slate-100 pt-4 md:border-t-0 md:pt-0 md:items-end">
              <LocaleSwitcher compact className="vs-locale-switch w-full md:w-auto md:justify-end" />
              {/* Push button */}
              {!isMock && (
                <button
                  type="button"
                  onClick={() => void handlePushAll()}
                  disabled={isPushing || enabledConfigCount === 0}
                  className={[
                    'inline-flex w-full md:w-auto items-center justify-center gap-2 rounded-xl border px-4 py-2.5 sm:px-5 text-sm font-bold transition-colors text-center leading-snug',
                    isPushing || enabledConfigCount === 0
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 hover:border-indigo-700 shadow-sm',
                  ].join(' ')}
                >
                  {isPushing ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden />
                  )}
                  {isPushing ? t('push.pushing') : t('push.button', { count: enabledConfigCount })}
                </button>
              )}

              {/* Push result summary */}
              {pushResults.length > 0 && !isPushing && (
                <div className="flex items-center gap-3 text-[11px]">
                  {successCount > 0 && (
                    <span className="flex items-center gap-1 font-bold text-emerald-600">
                      <CheckCheck className="h-3 w-3" aria-hidden />
                      {t('push.successCount', { count: successCount })}
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1 font-bold text-rose-600">
                      <XCircle className="h-3 w-3" aria-hidden />
                      {t('push.failCount', { count: errorCount })}
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Clock className="h-3 w-3 shrink-0" aria-hidden />
                <span>{t('header.generatedAt', { time: timeStr })}</span>
              </div>
              <div className="text-[11px] text-slate-400">{t('header.vendorCount', { count: data.vendors.length })}</div>
            </div>
          </div>
        </div>

        {/* Summary strip */}
        <SummaryStrip vendors={data.vendors} />

        {/* Color legend */}
        <Legend />

        {/* Vendor sections */}
        <div className="space-y-4 sm:space-y-6">
          {data.vendors.map((vendor, i) => {
            const ps = pushState[vendor.vendorCode]
            const aiSummary = pickVendorAiSummary(data.aiSummaries, vendor.vendorCode, locale)
            const showAiLoading =
              aiSummaryLoading && !aiSummary && !isMock && data.vendors.length > 0
            return (
              <div key={vendor.vendorCode} className="relative">
                <VendorSection
                  vendor={vendor}
                  index={i}
                  aiSummary={aiSummary}
                  aiSummaryLoading={showAiLoading}
                  aiSummaryLoadingLabel={t('aiSummary.loading')}
                  before11Date={data.before11Date}
                  dispatch24hDate={data.dispatch24hDate}
                  complaintDateRange={data.complaintDateRange}
                />
                {ps && <VendorPushBadge status={ps.status} error={ps.error} />}
              </div>
            )
          })}
          {data.vendors.length === 0 && (
            <div className="rounded-2xl border border-slate-100 bg-white px-8 py-16 text-center shadow-sm">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-slate-200" aria-hidden />
              <p className="text-sm text-slate-400">{t('empty')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 sm:mt-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-slate-200 pt-4 sm:pt-6">
          <span className="text-[11px] text-slate-400">{t('footer')}</span>
          <span className="text-[11px] text-slate-400 tabular-nums">{timeStr}</span>
        </div>
      </div>
    </div>
  )
}
