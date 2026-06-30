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
import {
  loadVendorSnapshot,
  type VendorSnapshotData,
  type VendorSnapshotDriver,
  type VendorSnapshotPushConfig,
  type VendorSnapshotVendor,
} from './vendorSnapshotStorage'
import { postFeishuPushRichMessage } from '../PushNotifications/feishuWebhookTestApi'

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
        { courierCode: 'D001', courierName: 'Zhang Wei', routeCode: 'ADL-01-A', ofdCount: 48, before11OfdCount: 47, returnWarningCount: 0, dispatch24hCount: 44, totalDispatchCount: 45, dispatchRate24h: 0.978 },
        { courierCode: 'D002', courierName: 'Li Ming', routeCode: 'ADL-01-B', ofdCount: 52, before11OfdCount: 52, returnWarningCount: 0, dispatch24hCount: 48, totalDispatchCount: 52, dispatchRate24h: 0.923 },
        { courierCode: 'D003', courierName: 'Wang Fang', routeCode: 'ADL-02-A', ofdCount: 41, before11OfdCount: 38, returnWarningCount: 1, dispatch24hCount: 35, totalDispatchCount: 42, dispatchRate24h: 0.833 },
        { courierCode: 'D004', courierName: 'Chen Jing', routeCode: 'ADL-02-B', ofdCount: 39, before11OfdCount: 39, returnWarningCount: 0, dispatch24hCount: 37, totalDispatchCount: 39, dispatchRate24h: 0.949 },
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
        { courierCode: 'D011', courierName: 'Zhao Lei', routeCode: 'ADL-03-A', ofdCount: 55, before11OfdCount: 50, returnWarningCount: 2, dispatch24hCount: 38, totalDispatchCount: 48, dispatchRate24h: 0.792 },
        { courierCode: 'D012', courierName: 'Sun Hui', routeCode: 'ADL-03-B', ofdCount: 47, before11OfdCount: 44, returnWarningCount: 0, dispatch24hCount: 42, totalDispatchCount: 47, dispatchRate24h: 0.894 },
        { courierCode: 'D013', courierName: 'Liu Yang', routeCode: 'ADL-01-C', ofdCount: 38, before11OfdCount: 32, returnWarningCount: 1, dispatch24hCount: 26, totalDispatchCount: 36, dispatchRate24h: 0.722 },
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

function driverBefore11Tone(before11Count: number, total: number): ColorTone {
  if (total === 0) return 'muted'
  const rate = before11Count / total
  if (rate >= 0.99) return 'green'
  if (rate >= 0.95) return 'amber'
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
  value,
  tone,
  sub,
  subTone,
  accent,
  icon: Icon,
}: {
  label: string
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
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${ac.header}`}>
        <Icon className={`h-4 w-4 shrink-0 ${ac.icon}`} aria-hidden />
        <span className={`text-[14px] font-bold ${ac.label}`}>{label}</span>
      </div>
      <div className="bg-white px-4 pt-3 pb-4 flex flex-col flex-1">
        <span className={`text-[34px] font-black leading-none tabular-nums ${valueClass}`}>{value}</span>
        {sub && <span className={`mt-3 text-[13px] leading-snug ${subClass}`}>{sub}</span>}
      </div>
    </div>
  )
}

// ── Driver Table ──────────────────────────────────────────────────────

function DriverRow({ driver, isOdd }: { driver: VendorSnapshotDriver; isOdd: boolean }) {
  const b11Rate = driver.ofdCount > 0 ? driver.before11OfdCount / driver.ofdCount : null
  const b11Tone = driverBefore11Tone(driver.before11OfdCount, driver.ofdCount)
  const dTone = driverDispatchTone(driver.dispatchRate24h)
  const { value: b11Class } = toneClasses(b11Tone)
  const { value: dClass } = toneClasses(dTone)
  const rowBg = isOdd ? 'bg-amber-50/40' : 'bg-white'

  return (
    <tr className={rowBg}>
      <td className="px-4 py-3 border-b border-slate-100">
        <div className="text-[15px] font-semibold text-slate-800 leading-tight">
          {driver.courierName || driver.courierCode}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5 font-mono">{driver.courierCode}</div>
      </td>
      <td className="px-4 py-3 border-b border-slate-100">
        <span className="text-[13px] font-mono text-slate-400">{driver.routeCode || '-'}</span>
      </td>
      <td className="px-4 py-3 text-center border-b border-slate-100">
        <span className="text-[15px] font-bold tabular-nums text-slate-700">{driver.ofdCount}</span>
      </td>
      <td className="px-4 py-3 text-center border-b border-slate-100">
        {driver.ofdCount > 0 ? (
          <div>
            <span className={`text-[15px] font-black tabular-nums ${b11Class}`}>
              {b11Rate != null ? `${(b11Rate * 100).toFixed(1)}%` : '-'}
            </span>
            <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
              {driver.before11OfdCount}/{driver.ofdCount}
            </div>
          </div>
        ) : (
          <span className="text-[15px] text-slate-300">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center border-b border-slate-100">
        {driver.totalDispatchCount > 0 ? (
          <div>
            <span className={`text-[15px] font-black tabular-nums ${dClass}`}>
              {driver.dispatchRate24h != null
                ? `${(driver.dispatchRate24h * 100).toFixed(1)}%`
                : '-'}
            </span>
            <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
              {driver.dispatch24hCount}/{driver.totalDispatchCount}
            </div>
          </div>
        ) : (
          <span className="text-[15px] text-slate-300">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center border-b border-slate-100">
        {driver.returnWarningCount > 0 ? (
          <span className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-black text-rose-600">
            {driver.returnWarningCount}
          </span>
        ) : (
          <span className="inline-flex items-center justify-center rounded-full border border-slate-100 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
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

function AiSummaryBlock({ summary }: { summary: string }) {
  return (
    <div className="mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
      <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" aria-hidden />
      <p className="text-[13px] leading-relaxed text-indigo-900">{summary}</p>
    </div>
  )
}

function VendorSection({ vendor, index, aiSummary }: { vendor: VendorSnapshotVendor; index: number; aiSummary?: string }) {
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
      className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-md"
    >
      {/* Vendor header */}
      <div className="flex items-center gap-4 px-6 py-5 bg-white border-b border-slate-100">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
          <span className="text-sm font-black text-white tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-black text-slate-900 leading-tight truncate">
            {vendor.vendorName}
          </h2>
          <div className="text-[13px] text-slate-400 mt-0.5 font-mono">{vendor.vendorCode}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {totalReturnWarning > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-600">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              归班预警 {totalReturnWarning}
            </span>
          )}
          {lowDispatchCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-600">
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
              派签未达标 {lowDispatchCount} 人
            </span>
          )}
          {vendor.unprocessedTicketCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-bold text-rose-600">
              <Package className="h-3 w-3 shrink-0" aria-hidden />
              未处理工单 {vendor.unprocessedTicketCount}
            </span>
          )}
          {vendor.isDisabled && (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-400">
              推送已禁用
            </span>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-5 gap-3 p-4">
        <KpiCard
          label="11点前出仓率"
          accent="blue"
          icon={Clock}
          value={vendor.before11ExitRate != null ? `${(vendor.before11ExitRate * 100).toFixed(1)}%` : '-'}
          tone={b11Tone}
          sub={
            vendor.before11ExitVolume != null && vendor.before11TotalReceived != null
              ? `${vendor.before11ExitVolume} / ${vendor.before11TotalReceived} 件`
              : undefined
          }
          subTone="muted"
        />
        <KpiCard
          label="24H 签派率"
          accent="violet"
          icon={Zap}
          value={vendor.dispatchRate24hText ?? '-'}
          tone={d24Tone}
          sub={
            vendor.notMet24hSignCount != null
              ? vendor.notMet24hSignCount > 0
                ? `${vendor.notMet24hSignCount} 票未达标`
                : '全部达标'
              : undefined
          }
          subTone={vendor.notMet24hSignCount != null ? (vendor.notMet24hSignCount > 0 ? 'warn' : 'ok') : 'muted'}
        />
        <KpiCard
          label="客诉率"
          accent="rose"
          icon={MessageSquare}
          value={`${(vendor.complaintRate * 100).toFixed(3)}%`}
          tone={crTone}
          sub={`${vendor.complaintCount} 件客诉 · 揽收 ${vendor.waybillCount} 件`}
          subTone="muted"
        />
        <KpiCard
          label="未处理工单"
          accent="orange"
          icon={Inbox}
          value={String(vendor.unprocessedTicketCount)}
          tone={utTone}
          sub={vendor.unprocessedTicketCount > 0 ? '需及时处理' : '暂无待处理'}
          subTone={vendor.unprocessedTicketCount > 0 ? 'warn' : 'ok'}
        />
        <KpiCard
          label="长尾单"
          accent="teal"
          icon={Timer}
          value={String(vendor.longTailCount)}
          tone={ltTone}
          sub={vendor.longTailCount > 0 ? `${vendor.longTailCount} 件待跟进` : '无长尾件'}
          subTone={vendor.longTailCount > 0 ? 'warn' : 'ok'}
        />
      </div>

      {/* AI summary */}
      {aiSummary && <AiSummaryBlock summary={aiSummary} />}

      {/* Driver table */}
      {vendor.drivers.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="flex items-center gap-2 px-6 py-3 bg-amber-50/40 border-b border-amber-100/60">
            <Users className="h-4 w-4 text-slate-400" aria-hidden />
            <span className="text-[13px] font-bold uppercase tracking-[0.12em] text-slate-500">
              派件员表现
            </span>
            <span className="ml-auto text-[12px] text-slate-400">{vendor.drivers.length} 位</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-amber-50/40">
                  <th className="px-4 py-2.5 text-left text-[13px] font-bold text-slate-500 border-b border-slate-100">
                    派件员
                  </th>
                  <th className="px-4 py-2.5 text-left text-[13px] font-bold text-slate-500 border-b border-slate-100">
                    路由码
                  </th>
                  <th className="px-4 py-2.5 text-center text-[13px] font-bold text-slate-500 border-b border-slate-100">
                    今日取件
                  </th>
                  <th className="px-4 py-2.5 text-center text-[13px] font-bold text-slate-500 border-b border-slate-100">
                    11点前出仓
                  </th>
                  <th className="px-4 py-2.5 text-center text-[13px] font-bold text-slate-500 border-b border-slate-100">
                    24H 签派
                  </th>
                  <th className="px-4 py-2.5 text-center text-[13px] font-bold text-slate-500 border-b border-slate-100">
                    归班预警
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
    </div>
  )
}

// ── Summary strip ─────────────────────────────────────────────────────

function SummaryStrip({ vendors }: { vendors: VendorSnapshotVendor[] }) {
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
    <div className="grid grid-cols-4 gap-4 mb-8">
      <div className="rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">供应商数量</div>
        <div className="text-5xl font-black tabular-nums text-slate-800">{vendors.length}</div>
        <div className="mt-2 text-xs text-slate-400">{activeVendors.length} 家推送启用</div>
      </div>
      <div className="rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">未处理工单</div>
        <div className={`text-5xl font-black tabular-nums ${totalUnprocessed > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
          {totalUnprocessed}
        </div>
        <div className={`mt-2 text-xs font-medium ${totalUnprocessed > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
          {totalUnprocessed > 0 ? '待及时处理' : '全部清空'}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">长尾件合计</div>
        <div className={`text-5xl font-black tabular-nums ${totalLongTail > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
          {totalLongTail}
        </div>
        <div className={`mt-2 text-xs font-medium ${totalLongTail > 0 ? 'text-amber-500' : 'text-emerald-600'}`}>
          {totalLongTail > 0 ? '件待跟进' : '无长尾件'}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-3">指标预警供应商</div>
        <div className={`text-5xl font-black tabular-nums ${vendorsWithIssues > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
          {vendorsWithIssues}
        </div>
        <div className={`mt-2 text-xs font-medium ${vendorsWithIssues > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
          {vendorsWithIssues > 0 ? `${vendorsWithIssues} 家需关注` : '全部达标'}
        </div>
      </div>
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-8 px-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">颜色说明</span>
      <LegendItem tone="green" label="达标" />
      <LegendItem tone="amber" label="预警" />
      <LegendItem tone="red" label="未达标" />
      <span className="text-[11px] text-slate-400 ml-2">
        出仓率 &ge;99% / 派签率 &ge;95% / 客诉率 &le;0.025% 为达标
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

// ── Push helpers ──────────────────────────────────────────────────────

type VendorPushStatus = 'idle' | 'capturing' | 'pushing' | 'ok' | 'error'
type PushStateMap = Record<string, { status: VendorPushStatus; error?: string }>

// ── Push badge (overlaid on each vendor section while capturing/pushing) ──

function VendorPushBadge({ status, error }: { status: VendorPushStatus; error?: string }) {
  if (status === 'idle') return null
  if (status === 'capturing' || status === 'pushing') {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[2px]">
        <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-white px-5 py-2.5 shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-600" aria-hidden />
          <span className="text-sm font-semibold text-indigo-700">
            {status === 'capturing' ? '正在截图...' : '正在推送...'}
          </span>
        </div>
      </div>
    )
  }
  if (status === 'ok') {
    return (
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 shadow-sm">
        <CheckCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        <span className="text-[11px] font-bold text-emerald-700">已推送</span>
      </div>
    )
  }
  return (
    <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 shadow-sm max-w-[240px]">
      <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />
      <span className="text-[11px] font-bold text-rose-700 truncate">{error ?? '推送失败'}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────

const AUTO_PUSH = new URLSearchParams(
  typeof window !== 'undefined' ? window.location.search : '',
).has('autoPush')

export default function VendorSnapshotPage() {
  const [data, setData] = useState<VendorSnapshotData | null>(null)
  const [isMock, setIsMock] = useState(false)
  const [pushState, setPushState] = useState<PushStateMap>({})
  const [isPushing, setIsPushing] = useState(false)
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
        setPushState((s) => ({ ...s, [config.vendorCode]: { status: 'error', error: '找不到对应区块' } }))
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
            error: '截图失败: ' + (err instanceof Error ? err.message : '未知错误'),
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
          : { status: 'error', error: 'error' in result ? result.error : '推送失败' },
      }))
    }

    pushingRef.current = false
    setIsPushing(false)
  }, [data])

  // 检测 ?autoPush=1，页面渲染后自动触发推送
  useEffect(() => {
    if (!AUTO_PUSH || !data || isMock || autoPushFiredRef.current) return
    autoPushFiredRef.current = true
    const timer = setTimeout(() => { void handlePushAll() }, 800)
    return () => clearTimeout(timer)
  }, [data, isMock, handlePushAll])

  if (!data) return null

  const generatedAt = new Date(data.generatedAt)
  const timeStr = generatedAt.toLocaleString('zh-CN', {
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
    <div className="min-h-screen bg-white" id="vendor-snapshot-root">
      {/* Top accent bar */}
      <div className="h-1.5 bg-indigo-600" />

      <div className="max-w-[920px] mx-auto px-6 py-7">
        {/* Mock warning */}
        {isMock && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <p className="text-sm text-amber-700 font-medium">
              当前显示为示例数据。请在供应商数据分析页面获取数据后点击「截图并推送到飞书」，然后刷新此页。
            </p>
          </div>
        )}

        {/* Header card */}
        <div className="mb-8 rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-8">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600 mb-3">
                iMile Australia
              </div>
              <h1 className="text-[30px] font-black text-slate-900 leading-none">供应商数据日报</h1>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  参考日期 {data.reportDate}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  客诉统计 {data.complaintDateRange}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  {data.stations.join(' · ')}
                </span>
              </div>
            </div>

            <div className="shrink-0 flex flex-col items-end gap-3">
              {/* Push button */}
              {!isMock && (
                <button
                  type="button"
                  onClick={() => void handlePushAll()}
                  disabled={isPushing || enabledConfigCount === 0}
                  className={[
                    'inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-bold transition-colors',
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
                  {isPushing ? '推送中...' : `截图推送到飞书（${enabledConfigCount} 个群）`}
                </button>
              )}

              {/* Push result summary */}
              {pushResults.length > 0 && !isPushing && (
                <div className="flex items-center gap-3 text-[11px]">
                  {successCount > 0 && (
                    <span className="flex items-center gap-1 font-bold text-emerald-600">
                      <CheckCheck className="h-3 w-3" aria-hidden />
                      {successCount} 成功
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="flex items-center gap-1 font-bold text-rose-600">
                      <XCircle className="h-3 w-3" aria-hidden />
                      {errorCount} 失败
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Clock className="h-3 w-3 shrink-0" aria-hidden />
                <span>生成于 {timeStr}</span>
              </div>
              <div className="text-[11px] text-slate-400">{data.vendors.length} 家供应商</div>
            </div>
          </div>
        </div>

        {/* Summary strip */}
        <SummaryStrip vendors={data.vendors} />

        {/* Color legend */}
        <Legend />

        {/* Vendor sections */}
        <div className="space-y-6">
          {data.vendors.map((vendor, i) => {
            const ps = pushState[vendor.vendorCode]
            return (
              <div key={vendor.vendorCode} className="relative">
                <VendorSection
                  vendor={vendor}
                  index={i}
                  aiSummary={data.aiSummaries?.[vendor.vendorCode]}
                />
                {ps && <VendorPushBadge status={ps.status} error={ps.error} />}
              </div>
            )
          })}
          {data.vendors.length === 0 && (
            <div className="rounded-2xl border border-slate-100 bg-white px-8 py-16 text-center shadow-sm">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-slate-200" aria-hidden />
              <p className="text-sm text-slate-400">暂无供应商数据</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-10 flex items-center justify-between border-t border-slate-200 pt-6">
          <span className="text-[11px] text-slate-400">iMile Operations Analytics</span>
          <span className="text-[11px] text-slate-400 tabular-nums">{timeStr}</span>
        </div>
      </div>
    </div>
  )
}
