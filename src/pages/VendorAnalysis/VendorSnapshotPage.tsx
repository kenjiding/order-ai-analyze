import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar,
  MapPin,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  CheckCheck,
  XCircle,
  Loader2,
} from 'lucide-react'
import { toJpeg } from 'html-to-image'
import { FEISHU_PUSH_JPEG_QUALITY } from '../../utils/feishuScreenshotImageSettings'
import { LocaleSwitcher } from '../../components/I18n/LocaleSwitcher'
import { getDateTimeLocale } from '../../i18n'
import { useAppLocale, useVendorSnapshotTranslation } from '../../i18n/hooks'
import {
  loadVendorSnapshot,
  saveVendorSnapshot,
  type VendorSnapshotData,
  type VendorSnapshotPushConfig,
  type VendorSnapshotVendor,
} from './vendorSnapshotStorage'
import { Legend, VendorSection, vendorSectionId } from './components/snapshotSections'
import { fetchVendorAiSummaries, listShareLinks } from './vendorAnalysisApi'
import { rankVendors } from '../../../shared/vendorAnalysis/rankingScore'
import { toVendorRankingInput } from './toVendorRankingInput'
import {
  buildVendorAiInputsFromSnapshot,
  hasAiSummariesForLocale,
  mergeAiSummariesForLocale,
  pickVendorAiSummary,
} from './vendorSnapshotAi'
import { postFeishuPushRichMessage } from '../PushNotifications/feishuWebhookTestApi'
import {
  buildVendorFeishuPushContent,
  buildVendorFeishuPushIntro,
  type VendorFeishuPushLabels,
} from './buildVendorFeishuPushContent'
import './vendorSnapshotPage.css'

function buildVendorShareUrl(token: string): string {
  return `${window.location.origin}/vendor-daily/${token}`
}

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
      dispatch24hTotal: 229,
      dispatch24hCount: 221,
      unprocessedTicketCount: 0,
      longTailCount: 2,
      isDisabled: false,
      drivers: [
        { courierCode: 'D001', courierName: 'Zhang Wei', routeCode: 'ADL-01-A', ofdCount: 48, ofdWaybillNos: [], before11TotalCount: 48, before11OfdCount: 47, before11UnmetWaybillNos: [], returnWarningCount: 0, returnWarningWaybillNos: [], dispatch24hCount: 44, totalDispatchCount: 45, dispatchRate24h: 0.978, dispatch24hUnmetWaybillNos: [], longTailCount: 0, longTailWaybillNos: [] },
        { courierCode: 'D002', courierName: 'Li Ming', routeCode: 'ADL-01-B', ofdCount: 52, ofdWaybillNos: [], before11TotalCount: 52, before11OfdCount: 49, before11UnmetWaybillNos: [], returnWarningCount: 0, returnWarningWaybillNos: [], dispatch24hCount: 48, totalDispatchCount: 52, dispatchRate24h: 0.923, dispatch24hUnmetWaybillNos: [], longTailCount: 1, longTailWaybillNos: [] },
        { courierCode: 'D003', courierName: 'Wang Fang', routeCode: 'ADL-02-A', ofdCount: 41, ofdWaybillNos: [], before11TotalCount: 41, before11OfdCount: 36, before11UnmetWaybillNos: [], returnWarningCount: 1, returnWarningWaybillNos: [], dispatch24hCount: 35, totalDispatchCount: 42, dispatchRate24h: 0.833, dispatch24hUnmetWaybillNos: [], longTailCount: 1, longTailWaybillNos: [] },
        { courierCode: 'D004', courierName: 'Chen Jing', routeCode: 'ADL-02-B', ofdCount: 39, ofdWaybillNos: [], before11TotalCount: 39, before11OfdCount: 39, before11UnmetWaybillNos: [], returnWarningCount: 0, returnWarningWaybillNos: [], dispatch24hCount: 37, totalDispatchCount: 39, dispatchRate24h: 0.949, dispatch24hUnmetWaybillNos: [], longTailCount: 0, longTailWaybillNos: [] },
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
      dispatch24hTotal: 203,
      dispatch24hCount: 179,
      unprocessedTicketCount: 3,
      longTailCount: 7,
      isDisabled: false,
      drivers: [
        { courierCode: 'D011', courierName: 'Zhao Lei', routeCode: 'ADL-03-A', ofdCount: 55, ofdWaybillNos: [], before11TotalCount: 55, before11OfdCount: 46, before11UnmetWaybillNos: [], returnWarningCount: 2, returnWarningWaybillNos: [], dispatch24hCount: 38, totalDispatchCount: 48, dispatchRate24h: 0.792, dispatch24hUnmetWaybillNos: [], longTailCount: 3, longTailWaybillNos: [] },
        { courierCode: 'D012', courierName: 'Sun Hui', routeCode: 'ADL-03-B', ofdCount: 47, ofdWaybillNos: [], before11TotalCount: 47, before11OfdCount: 44, before11UnmetWaybillNos: [], returnWarningCount: 0, returnWarningWaybillNos: [], dispatch24hCount: 42, totalDispatchCount: 47, dispatchRate24h: 0.894, dispatch24hUnmetWaybillNos: [], longTailCount: 2, longTailWaybillNos: [] },
        { courierCode: 'D013', courierName: 'Liu Yang', routeCode: 'ADL-01-C', ofdCount: 38, ofdWaybillNos: [], before11TotalCount: 38, before11OfdCount: 30, before11UnmetWaybillNos: [], returnWarningCount: 1, returnWarningWaybillNos: [], dispatch24hCount: 26, totalDispatchCount: 36, dispatchRate24h: 0.722, dispatch24hUnmetWaybillNos: [], longTailCount: 2, longTailWaybillNos: [] },
      ],
    },
  ],
}

// ── Summary strip ─────────────────────────────────────────────────────

/** Tailwind 不能拼接动态类名，汇总 tile 数量 → 桌面端列数用静态映射 */
const SUMMARY_GRID_COLS: Record<number, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
}

function SummaryStrip({
  vendors,
  enabledMetricKeys,
  rankingSummary,
}: {
  vendors: VendorSnapshotVendor[]
  enabledMetricKeys?: ReadonlySet<string>
  rankingSummary?: { topScore: number | null; bottomScore: number | null; median: number | null; poolSize: number }
}) {
  const { t } = useVendorSnapshotTranslation()
  const showUnprocessed = enabledMetricKeys?.has('vendor.unprocessedTickets') ?? true
  const showLongTail = enabledMetricKeys?.has('vendor.longTail') ?? true
  const showRanking = (rankingSummary?.poolSize ?? 0) >= 2
  const tileCount = 2 + (showUnprocessed ? 1 : 0) + (showLongTail ? 1 : 0) + (showRanking ? 1 : 0)
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
    <div className={`grid grid-cols-2 ${SUMMARY_GRID_COLS[tileCount] ?? 'md:grid-cols-4'} gap-3 sm:gap-4 mb-6 sm:mb-8`}>
      <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
        <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.vendorCount')}</div>
        <div className="text-3xl sm:text-5xl font-black tabular-nums text-slate-800">{vendors.length}</div>
        <div className="mt-2 text-xs text-slate-400">{t('summary.pushEnabled', { count: activeVendors.length })}</div>
      </div>
      {showRanking && (
        <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
          <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.ranking')}</div>
          <div className="text-3xl sm:text-5xl font-black tabular-nums text-indigo-600">
            {rankingSummary?.topScore != null ? rankingSummary.topScore.toFixed(0) : '—'}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {t('summary.rankingRange', {
              top: rankingSummary?.topScore?.toFixed(1) ?? '—',
              bottom: rankingSummary?.bottomScore?.toFixed(1) ?? '—',
              median: rankingSummary?.median?.toFixed(1) ?? '—',
            })}
          </div>
        </div>
      )}
      {showUnprocessed && (
        <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
          <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.unprocessedTickets')}</div>
          <div className={`text-3xl sm:text-5xl font-black tabular-nums ${totalUnprocessed > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
            {totalUnprocessed}
          </div>
          <div className={`mt-2 text-xs font-medium ${totalUnprocessed > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
            {totalUnprocessed > 0 ? t('summary.pendingAction') : t('summary.allClear')}
          </div>
        </div>
      )}
      {showLongTail && (
        <div className="rounded-xl sm:rounded-2xl border border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 shadow-sm min-w-0">
          <div className="text-xs font-bold text-slate-500 leading-snug mb-2 sm:mb-3">{t('summary.longTailTotal')}</div>
          <div className={`text-3xl sm:text-5xl font-black tabular-nums ${totalLongTail > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
            {totalLongTail}
          </div>
          <div className={`mt-2 text-xs font-medium ${totalLongTail > 0 ? 'text-amber-500' : 'text-emerald-600'}`}>
            {totalLongTail > 0 ? t('summary.itemsToFollowUp') : t('summary.noLongTail')}
          </div>
        </div>
      )}
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
  // ref 而非 state：避免其更新导致 handlePushAll 引用变化，进而清掉已排好的自动推送定时器
  const shareTokenByVendorRef = useRef<Record<string, string>>({})
  const localeRef = useRef(locale)
  localeRef.current = locale

  // 老快照无 enabledMetricKeys → undefined → 全量渲染
  const enabledSet = useMemo(
    () => (data?.enabledMetricKeys ? new Set(data.enabledMetricKeys) : undefined),
    [data],
  )

  const rankingPool = useMemo(() => {
    if (!data?.vendors.length) return null
    return rankVendors(
      data.vendors.map((v) => toVendorRankingInput(v)),
      enabledSet,
    )
  }, [data, enabledSet])

  /** 综合排名对标池 = 推送启用供应商（与分享链接 / webhookConfigs 口径一致） */
  const pushRankingPool = useMemo(() => {
    if (!data?.vendors.length) return null
    const active = data.vendors.filter((v) => !v.isDisabled)
    if (active.length === 0) return null
    return rankVendors(active.map((v) => toVendorRankingInput(v)), enabledSet)
  }, [data, enabledSet])

  const sortedVendors = useMemo(() => {
    if (!data?.vendors) return []
    if (!rankingPool || rankingPool.poolSize < 2) return data.vendors
    return [...data.vendors].sort((a, b) => {
      const ra = rankingPool.byVendorCode.get(a.vendorCode)?.rank ?? 999
      const rb = rankingPool.byVendorCode.get(b.vendorCode)?.rank ?? 999
      return ra - rb
    })
  }, [data, rankingPool])

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
    // AI 总开关关闭的快照：不展示 AI 块，切换语言也不补拉
    if (data.aiSummaryEnabled === false) return
    if (hasAiSummariesForLocale(data.aiSummaries, data.vendors, locale)) {
      setAiSummaryLoading(false)
      return
    }

    let cancelled = false
    setAiSummaryLoading(true)
    void (async () => {
      const result = await fetchVendorAiSummaries(
        buildVendorAiInputsFromSnapshot(data.vendors, enabledSet),
        locale,
        data.enabledMetricKeys,
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
  }, [data, isMock, locale, enabledSet])

  // 推送到飞书时需要在文案末尾附上可点击的分享链接：按 jobId 查一次该任务下各供应商的 token
  useEffect(() => {
    if (isMock || !data?.jobId) return
    let cancelled = false
    void listShareLinks(data.jobId).then((res) => {
      if (cancelled || !res.ok) return
      const map: Record<string, string> = {}
      for (const link of res.data) {
        if (!link.isDisabled) map[link.vendorCode] = link.token
      }
      shareTokenByVendorRef.current = map
    })
    return () => {
      cancelled = true
    }
  }, [data?.jobId, isMock])

  const pushLabels = useMemo((): VendorFeishuPushLabels => ({
    introTitleSuffix: t('push.introTitleSuffix'),
    rankingHeading: t('push.rankingHeading'),
    rankPrefix: t('ranking.rankPrefix'),
    scoreUnit: t('ranking.scoreUnit'),
    sampleInsufficient: t('ranking.sampleInsufficient'),
    before11ExitRate: t('kpi.before11ExitRate'),
    dispatch24h: t('kpi.dispatch24h'),
    complaintRate: t('kpi.complaintRate'),
    unprocessedTickets: t('kpi.unprocessedTickets'),
    longTail: t('kpi.longTail'),
    pieces: (done, total) => t('kpi.pieces', { done, total }),
    complaintSub: (complaints, waybills) => t('kpi.complaintSub', { complaints, waybills }),
    ticketsNotMet: (count) => t('kpi.ticketsNotMet', { count }),
    shareLinkText: t('push.shareLinkText'),
  }), [t])

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
        dataUrl = await toJpeg(el, { pixelRatio: 1.0, quality: FEISHU_PUSH_JPEG_QUALITY, backgroundColor: '#ffffff' })
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
      const ranking = pushRankingPool?.byVendorCode.get(config.vendorCode)
      const intro = buildVendorFeishuPushIntro({
        vendorName: config.vendorName,
        vendor,
        ranking,
        enabledMetricKeys: enabledSet,
        labels: pushLabels,
      })
      const shareToken = shareTokenByVendorRef.current[config.vendorCode]
      const content = buildVendorFeishuPushContent({
        intro,
        shareUrl: shareToken ? buildVendorShareUrl(shareToken) : undefined,
        shareLinkText: shareToken ? pushLabels.shareLinkText : undefined,
      })

      const result = await postFeishuPushRichMessage({
        pushScope: 'vendor-analysis',
        webhookUrl: config.webhookUrl,
        signingSecret: config.signingSecret ?? undefined,
        content,
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
  }, [data, enabledSet, pushLabels, pushRankingPool])

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
          <div className="text-[10px] sm:text-xs font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] text-indigo-600 mb-2 sm:mb-3">
            {t('brand')}
          </div>
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <h1 className="min-w-0 text-2xl sm:text-[30px] font-black text-slate-900 leading-tight sm:leading-none">
              {t('title')}
            </h1>
            <LocaleSwitcher inline className="vs-locale-switch shrink-0" />
          </div>
          <div className="hidden sm:mt-5 sm:grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 sm:gap-6 items-start">
            <div className="min-w-0 flex flex-col min-[420px]:flex-row min-[420px]:flex-wrap gap-2 sm:gap-3">
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{t('header.referenceDate')} {data.reportDate}</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{t('header.complaintStats')} {data.complaintDateRange}</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-600 w-fit max-w-full">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="break-all">{data.stations.join(' · ')}</span>
                </span>
            </div>

            <div className="shrink-0 flex flex-col items-stretch gap-3 border-t border-slate-100 pt-4 md:border-t-0 md:pt-0 md:items-end">
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
        <SummaryStrip
          vendors={data.vendors}
          enabledMetricKeys={enabledSet}
          rankingSummary={
            rankingPool
              ? {
                  topScore: rankingPool.topScore,
                  bottomScore: rankingPool.bottomScore,
                  median: rankingPool.poolMedianScore,
                  poolSize: rankingPool.poolSize,
                }
              : undefined
          }
        />

        {/* Color legend */}
        <Legend />

        {/* Vendor sections */}
        <div className="space-y-4 sm:space-y-6">
          {sortedVendors.map((vendor, i) => {
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
                  enabledMetricKeys={enabledSet}
                  ranking={pushRankingPool?.byVendorCode.get(vendor.vendorCode)}
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
