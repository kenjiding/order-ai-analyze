import { Button, Drawer, Form, Image, Input, Modal, Select, Spin, Tag, Timeline } from 'antd'
import {
  AlertTriangle,
  ClipboardCheck,
  Package,
  Route,
  ShieldAlert,
} from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DrawerCloseButton } from '../../../components/Drawer/DrawerCloseButton'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { showToast } from '../../../utils/toast'
import {
  getClosureVendors,
  getTrackProofImageUrl,
  postClosureDriverVendor,
  postClosureExceptionAdd,
  type ClosureExceptionTypeOption,
  type ClosureVendorOption,
  type OrderAnalyzeInterceptLog,
} from '../orderExceptionApi'
import type { TrackEvent } from '../types'
import type { OrderQueryInfo } from '../orderExceptionApi'
import type { AnalysisRow } from '../useOrderExceptionManagementPage'

type Row = AnalysisRow
type ClosureExceptionTypeKey = ClosureExceptionTypeOption['key']

const STAGE_DOT_COLOR: Record<string, string> = {
  订单提交: 'blue',
  已揽件: 'cyan',
  转运: 'purple',
  派送: 'green',
}

const TRACK_TYPE_COLORS: Record<string, string> = {
  Schedule: 'processing',
  Problem: 'error',
  Delivery: 'success',
}

let closureVendorMemoryCache: ClosureVendorOption[] | null = null

const TRACK_INLINE_ACTION_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)|(【View Proof】)/gi

function sortTrackEventsDesc(events: TrackEvent[]): TrackEvent[] {
  return [...events].sort((a, b) => b.time.localeCompare(a.time))
}

function sortInterceptLogsDesc(logs: OrderAnalyzeInterceptLog[]): OrderAnalyzeInterceptLog[] {
  return [...logs].sort((a, b) => (b.gmtScan || b.gmtIntercept).localeCompare(a.gmtScan || a.gmtIntercept))
}

function isOutResponsibility(row: Row): boolean {
  if (row.activeResponsibilityOwner === 'external_carrier') return true
  if (row.lossScope === '库外丢失') return true
  return row.latestResponsibility?.owner === 'out_warehouse'
}

function readLatestProblemTrack(events: TrackEvent[]): TrackEvent | null {
  const sorted = sortTrackEventsDesc(events)
  for (const event of sorted) {
    const trackType = String(event.trackType ?? '').trim().toLowerCase()
    if (trackType === 'problem' || event.content.includes('登记问题件')) return event
  }
  return null
}

function hitTheftSignal(events: TrackEvent[]): boolean {
  const latestProblemTrack = readLatestProblemTrack(events)
  if (!latestProblemTrack) return false
  return latestProblemTrack.content.includes('盗抢')
}

function inferClosureExceptionTypeKey(row: Row): ClosureExceptionTypeKey | null {
  if (row.lossScope === '3PL丢件') return 'aus_3PL_lost_items'
  if (isOutResponsibility(row) && hitTheftSignal(row.trackEvents)) return 'aus_Theft_and_robbery'
  if (row.lossScope === '库内丢失') return 'aus_Packet_loss_in_the_station'
  if (row.lossScope === '库外丢失') return 'aus_packet_loss_out_the_station'
  return null
}

function renderTrackContentWithDriverIdClickable(
  content: string,
  onPickDriverId: (driverId: string) => void,
  fillCourierTitle: (id: string) => string,
  proofFileKeys: string[] | undefined,
  onViewProof: (fileKeys: string[]) => void,
): ReactNode {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let matched = false

  for (const match of content.matchAll(TRACK_INLINE_ACTION_RE)) {
    const index = match.index ?? 0
    const fullText = match[0]
    const driverId = match[1]?.trim() ?? ''
    const isViewProofMarker = Boolean(match[2]) && Boolean(proofFileKeys?.length)
    if (!driverId && !isViewProofMarker) continue
    matched = true

    if (index > lastIndex) nodes.push(content.slice(lastIndex, index))

    nodes.push(
      driverId ? (
        <button
          key={`${index}-${driverId}`}
          type="button"
          onClick={() => onPickDriverId(driverId)}
          className="mx-0.5 inline-flex items-center rounded px-1 py-0.5 font-mono text-[12px] font-semibold text-[#1f6f68] underline decoration-dotted underline-offset-2 hover:bg-emerald-50 hover:text-[#2f8f87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8f87]/30"
          title={fillCourierTitle(driverId)}
        >
          {fullText}
        </button>
      ) : (
        <button
          key={`${index}-view-proof`}
          type="button"
          onClick={() => onViewProof(proofFileKeys ?? [])}
          className="mx-0.5 inline-flex items-center rounded px-1 py-0.5 text-[13px] font-semibold text-blue-600 underline decoration-dotted underline-offset-2 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {fullText}
        </button>
      )
    )

    lastIndex = index + fullText.length
  }

  if (!matched) return content
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex))
  return nodes
}

function formatOrderInfoField(value: string | undefined | null): string {
  const s = String(value ?? '').trim()
  return s || '—'
}

function hasOrderInfoContent(orderInfo: OrderQueryInfo | null | undefined): boolean {
  if (!orderInfo) return false
  return [
    orderInfo.merchantName,
    orderInfo.merchantCode,
    orderInfo.amName,
    orderInfo.totalWeight,
    orderInfo.customerDeclaredValueAud,
    orderInfo.declaredValueUsd,
  ].some((v) => String(v ?? '').trim() !== '')
}

function OrderInfoMetaLine({
  orderInfo,
  t,
}: {
  orderInfo: OrderQueryInfo | null | undefined
  t: (key: string) => string
}) {
  if (!hasOrderInfoContent(orderInfo)) return null

  const items: { label: string; value: string }[] = [
    { label: t('drawer.merchant'), value: formatOrderInfoField(orderInfo?.merchantName) },
    { label: t('drawer.merchantCode'), value: formatOrderInfoField(orderInfo?.merchantCode) },
    { label: t('drawer.amName'), value: formatOrderInfoField(orderInfo?.amName) },
    { label: t('drawer.weightKg'), value: formatOrderInfoField(orderInfo?.totalWeight) },
    { label: t('drawer.declaredAud'), value: formatOrderInfoField(orderInfo?.customerDeclaredValueAud) },
    { label: t('drawer.declaredUsd'), value: formatOrderInfoField(orderInfo?.declaredValueUsd) },
  ].filter((item) => item.value !== '—')

  if (!items.length) return null

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 pt-2.5 text-sm leading-snug text-white/85">
      {items.map((item, index) => (
        <span key={item.label} className="inline-flex min-w-0 items-center gap-x-2">
          <span className="min-w-0 truncate">
            <span className="text-white/50">{item.label}</span>{': '}
            <span className="font-semibold text-white/95">{item.value}</span>
          </span>
          {index < items.length - 1 ? <span className="text-white/25" aria-hidden>·</span> : null}
        </span>
      ))}
    </p>
  )
}

function DrawerSectionHeader({
  icon,
  eyebrow,
  title,
  count,
  countTone = 'default',
  entryCountLabel = (count: number) => String(count),
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  count?: number
  countTone?: 'default' | 'muted'
  entryCountLabel?: (count: number) => string
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--admin-line)] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#c8deee] bg-[var(--admin-sky-soft)] text-[#25526e]">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="admin-eyebrow">{eyebrow}</p>
          <h4 className="mt-1 text-[15px] font-semibold tracking-tight text-slate-950">{title}</h4>
        </div>
      </div>
      {count != null ? (
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
            countTone === 'muted'
              ? 'border border-slate-200 bg-slate-100 text-slate-600'
              : 'border border-[#b8ddd7] bg-[var(--admin-accent-soft)] text-[#1f6f68]'
          }`}
        >
          {entryCountLabel(count)}
        </span>
      ) : null}
    </div>
  )
}

type Props = {
  row: Row | null
  onClose: () => void
}

export function OrderAnalysisDetailDrawer({ row, onClose }: Props) {
  const { t } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')
  const { imileToken } = useAppSettings()
  const stationCode = useGlobalFilterStore((state) => state.selectedStations[0] ?? '')
  const canSubmitClosure = usePermission(PERMISSION_KEYS.btnOrderExceptionClosureAdd)

  const [closureTypeKey, setClosureTypeKey] = useState<ClosureExceptionTypeKey | ''>('')
  const [closureRemark, setClosureRemark] = useState('')
  const [violence, setViolence] = useState<'0' | '1'>('0')
  const [vendorOptions, setVendorOptions] = useState<ClosureVendorOption[]>([])
  const [selectedVendorKey, setSelectedVendorKey] = useState('')
  const [detectedDriverId, setDetectedDriverId] = useState('')
  const [pendingAutoResolveDriverId, setPendingAutoResolveDriverId] = useState('')
  const [vendorAutoFillTip, setVendorAutoFillTip] = useState('')
  const [isLoadingVendors, setIsLoadingVendors] = useState(false)
  const [isResolvingVendor, setIsResolvingVendor] = useState(false)
  const [isSubmittingClosure, setIsSubmittingClosure] = useState(false)
  const [proofPreview, setProofPreview] = useState<{
    open: boolean
    loading: boolean
    urls: string[]
    error: string
  }>({ open: false, loading: false, urls: [], error: '' })
  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const barcodeSvgRef = useRef<SVGSVGElement | null>(null)

  const closureExceptionTypeOptions = useMemo(
    () => [
      { key: 'aus_Packet_loss_in_the_station' as const, value: t('drawer.closureTypeInHubLoss'), label: null },
      { key: 'aus_packet_loss_out_the_station' as const, value: t('drawer.closureTypeLastMileLoss'), label: null },
      { key: 'aus_Theft_and_robbery' as const, value: t('drawer.closureTypeTheft'), label: null },
      {
        key: 'aus_Damaged_before_entering_the_station' as const,
        value: t('drawer.closureTypeDamagedBeforeHub'),
        label: null,
      },
      {
        key: 'aus_Empty_package_before_entering_the_station' as const,
        value: t('drawer.closureTypeEmptyBeforeHub'),
        label: null,
      },
      { key: 'aus_3PL_lost_items' as const, value: t('drawer.closureType3plLoss'), label: null },
    ],
    [t],
  )

  const violenceOptions = useMemo(
    () => [
      { value: '0' as const, label: tc('no') },
      { value: '1' as const, label: tc('yes') },
    ],
    [tc],
  )

  const trackTypeLabels = useMemo(
    () => ({
      Schedule: t('drawer.trackTypeSchedule'),
      Problem: t('drawer.trackTypeProblem'),
      Delivery: t('drawer.trackTypeDelivery'),
    }),
    [t],
  )

  const fillCourierTitle = useCallback(
    (id: string) => t('drawer.fillCourierIdTitle', { id }),
    [t],
  )

  const entryCountLabel = useCallback(
    (count: number) => t('drawer.entryCount', { count }),
    [t],
  )

  useEffect(() => {
    if (!row) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [row])

  useEffect(() => {
    if (!row) {
      setClosureTypeKey('')
      setClosureRemark('')
      setViolence('0')
      setVendorOptions([])
      setSelectedVendorKey('')
      setDetectedDriverId('')
      setPendingAutoResolveDriverId('')
      setVendorAutoFillTip('')
      setBarcodeOpen(false)
      return
    }

    const inferred = inferClosureExceptionTypeKey(row)
    setClosureTypeKey(inferred ?? '')
    setClosureRemark(row.reason || '')
    setViolence('0')
    setSelectedVendorKey('')
    setVendorAutoFillTip('')
    setDetectedDriverId(row.detectedDriverId ?? '')
    setPendingAutoResolveDriverId(row.detectedDriverId ?? '')
  }, [row])

  const loadClosureVendors = useCallback(async () => {
    const token = imileToken.trim()
    if (!row || !token) return

    if (closureVendorMemoryCache) {
      setVendorOptions(closureVendorMemoryCache)
      return
    }

    setIsLoadingVendors(true)
    try {
      const { vendors } = await getClosureVendors({ imileToken: token })
      closureVendorMemoryCache = vendors
      setVendorOptions(vendors)
    } catch (e) {
      showToast((e as Error).message || t('toast.vendorListLoadFailed'), 'error')
    } finally {
      setIsLoadingVendors(false)
    }
  }, [row, imileToken, t])

  useEffect(() => {
    if (!row) return
    void loadClosureVendors()
  }, [row, loadClosureVendors])

  const resolveVendorByDriver = useCallback(
    async (driverId: string, nextStationCode: string) => {
      const token = imileToken.trim()
      if (!token || !driverId || !nextStationCode) return
      setIsResolvingVendor(true)
      try {
        const { result } = await postClosureDriverVendor({
          imileToken: token,
          driverId,
          stationCode: nextStationCode,
        })
        if (!result) {
          setVendorAutoFillTip(t('toast.vendorNotFoundForDriver'))
          return
        }

        setVendorAutoFillTip('')
        setVendorOptions((prev) => {
          const exists = prev.some((x) => x.key === result.vendorCode)
          if (exists) return prev
          const next = [...prev, { key: result.vendorCode, value: result.vendorName, label: null }]
          if (closureVendorMemoryCache) {
            closureVendorMemoryCache = next
          }
          return next
        })
        setSelectedVendorKey(result.vendorCode)
      } catch (e) {
        setVendorAutoFillTip(t('toast.vendorAutoResolveFailed'))
        showToast((e as Error).message || t('toast.driverVendorResolveFailed'), 'error')
      } finally {
        setIsResolvingVendor(false)
      }
    },
    [imileToken, t],
  )

  const handleViewProof = useCallback(
    async (fileKeys: string[]) => {
      const token = imileToken.trim()
      setProofPreview({ open: true, loading: true, urls: [], error: '' })
      if (!token || !fileKeys.length) {
        setProofPreview({ open: true, loading: false, urls: [], error: t('drawer.viewProofError') })
        return
      }
      const results = await Promise.allSettled(
        fileKeys.map((fileKey) => getTrackProofImageUrl({ imileToken: token, fileKey })),
      )
      const urls = results
        .filter((r): r is PromiseFulfilledResult<{ url: string }> => r.status === 'fulfilled')
        .map((r) => r.value.url)
      setProofPreview({
        open: true,
        loading: false,
        urls,
        error: urls.length ? '' : t('drawer.viewProofError'),
      })
    },
    [imileToken, t],
  )

  const handleTrackDriverIdPick = useCallback(
    (driverId: string) => {
      setDetectedDriverId(driverId)
      setSelectedVendorKey('')
      setVendorAutoFillTip('')
      const nextStationCode = stationCode.trim()
      if (nextStationCode) {
        setPendingAutoResolveDriverId('')
        void resolveVendorByDriver(driverId, nextStationCode)
        return
      }
      setPendingAutoResolveDriverId(driverId)
    },
    [resolveVendorByDriver, stationCode]
  )

  useEffect(() => {
    if (!row) return
    if (!isOutResponsibility(row)) return
    const driverId = pendingAutoResolveDriverId.trim()
    if (!driverId || !stationCode.trim()) return
    void resolveVendorByDriver(driverId, stationCode.trim())
    setPendingAutoResolveDriverId('')
  }, [row, pendingAutoResolveDriverId, stationCode, resolveVendorByDriver])

  const drawBarcode = useCallback(() => {
    if (!row || !barcodeSvgRef.current) return
    JsBarcode(barcodeSvgRef.current, row.orderNo, { format: 'CODE128', height: 60, displayValue: true })
  }, [row])

  const sortedTrackEvents = useMemo(() => (row ? sortTrackEventsDesc(row.trackEvents) : []), [row])
  const sortedInterceptLogs = useMemo(() => (row ? sortInterceptLogsDesc(row.interceptLogs) : []), [row])
  const latestResponsibilityMarker = row?.latestResponsibility ?? null
  const hasInterceptLogs = sortedInterceptLogs.length > 0
  const outResponsibility = row ? isOutResponsibility(row) : false

  const vendorSelectOptions = useMemo(
    () =>
      vendorOptions.map((x) => ({
        value: x.key,
        label: `${x.value} (${x.key})`,
      })),
    [vendorOptions]
  )

  const handleSubmitClosure = useCallback(async () => {
    if (!row) return

    const selectedTypeKey = closureTypeKey.trim() as ClosureExceptionTypeKey | ''
    if (!selectedTypeKey) {
      showToast(t('toast.selectClosureType'), 'error')
      return
    }

    const vendor = vendorOptions.find((x) => x.key === selectedVendorKey)
    const vendorRequired = outResponsibility || selectedTypeKey === 'aus_packet_loss_out_the_station'
    if (vendorRequired && !vendor) {
      showToast(t('toast.vendorRequiredForLastMile'), 'error')
      return
    }

    const token = imileToken.trim()
    if (!token) {
      showToast(t('toast.missingImileTokenClosure'), 'error')
      return
    }

    setIsSubmittingClosure(true)
    try {
      await postClosureExceptionAdd({
        imileToken: token,
        waybillNo: row.orderNo,
        exceptionCloseReason: selectedTypeKey,
        exceptionHandleRemark: closureRemark.trim(),
        vendorCode: vendor?.key ?? '',
        violence,
      })
      showToast(t('toast.closureAdded'), 'success')
    } catch (e) {
      showToast((e as Error).message || t('toast.closureAddFailed'), 'error')
    } finally {
      setIsSubmittingClosure(false)
    }
  }, [
    closureRemark,
    closureTypeKey,
    imileToken,
    row,
    outResponsibility,
    selectedVendorKey,
    vendorOptions,
    violence,
    t,
  ])

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      width={hasInterceptLogs ? 'min(980px, 92vw)' : 'min(760px, 92vw)'}
      destroyOnClose
      closable={false}
      title={null}
      className="order-analysis-drawer"
      styles={{
        body: { padding: 0 },
        header: { display: 'none' },
        mask: { backdropFilter: 'blur(2px)' },
      }}
    >
      {row ? (
        <div className="flex min-h-full flex-col bg-[linear-gradient(180deg,#f8fbfd_0%,#f3f8fb_38%,#f7faf9_100%)]">
          {/* Hero header */}
          <header className="relative overflow-hidden border-b border-[#1a5c56]/20 bg-[linear-gradient(135deg,#1a5c56_0%,#237a72_48%,#2f8f87_100%)] px-6 py-5 text-white shadow-[0_12px_40px_rgba(26,92,86,0.28)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.14]"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {row.needsReview ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/40 bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-50">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {t('drawer.needsReview')}
                    </span>
                  ) : null}
                  {outResponsibility ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-200/35 bg-orange-400/20 px-2.5 py-1 text-[11px] font-semibold text-orange-50">
                      <ShieldAlert className="h-3 w-3" aria-hidden />
                      {t('drawer.outOfHubResponsibility')}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm">
                      <Package className="h-5 w-5 text-white" aria-hidden />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">{t('drawer.orderNo')}</p>
                      <button
                        type="button"
                        onClick={() => setBarcodeOpen(true)}
                        title={t('drawer.orderNoBarcodeHint')}
                        className="font-mono text-xl font-semibold tracking-wide text-white underline decoration-dotted decoration-white/40 underline-offset-4 hover:decoration-white sm:text-2xl"
                      >
                        {row.orderNo}
                      </button>
                    </div>
                  </div>
                  <div className="hidden h-8 w-px bg-white/20 sm:block" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">{t('drawer.exceptionCategory')}</p>
                    <p className="truncate text-sm font-medium text-white/95">
                      {row.lossScope}
                      <span className="mx-2 text-white/40">/</span>
                      {row.categoryName}
                    </p>
                  </div>
                  <div className="hidden h-8 w-px bg-white/20 sm:block" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">{t('drawer.currentHub')}</p>
                    <p className="truncate text-sm font-semibold text-white/95">{row.currentResponsibilityParty || '—'}</p>
                  </div>
                  <div className="hidden h-8 w-px bg-white/20 sm:block" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">{t('drawer.confidence')}</p>
                    <p className="truncate text-sm font-medium text-white/95">{String(row.confidence ?? '—')}</p>
                  </div>
                </div>

                <OrderInfoMetaLine orderInfo={row.orderInfo} t={t} />
              </div>

              <DrawerCloseButton onClick={onClose} variant="onDark" aria-label={t('drawer.closeAria')} />
            </div>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {/* Closure */}
            <section className="admin-panel overflow-hidden">
              <DrawerSectionHeader
                icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
                eyebrow={t('drawer.closureEyebrow')}
                title={t('drawer.closureTitle')}
              />
              <div className="px-5 py-4">
                <Form layout="vertical" colon={false}>
                  <div className="grid gap-x-4 sm:grid-cols-2">
                    <Form.Item label={t('drawer.closureType')} required className="mb-3">
                      <Select<ClosureExceptionTypeKey>
                        value={closureTypeKey || undefined}
                        placeholder={t('drawer.closureTypePlaceholder')}
                        options={closureExceptionTypeOptions.map((x) => ({
                          value: x.key,
                          label: x.value,
                        }))}
                        onChange={(v) => setClosureTypeKey(v)}
                      />
                    </Form.Item>

                    <Form.Item
                      label={t('drawer.courierVendor')}
                      required={outResponsibility || closureTypeKey === 'aus_packet_loss_out_the_station'}
                      className="mb-3"
                      extra={vendorAutoFillTip || undefined}
                    >
                      <Select<string>
                        value={selectedVendorKey || undefined}
                        placeholder={isLoadingVendors ? t('drawer.vendorLoading') : t('drawer.vendorPlaceholder')}
                        showSearch
                        allowClear
                        loading={isLoadingVendors || isResolvingVendor}
                        options={vendorSelectOptions}
                        optionFilterProp="label"
                        onChange={(v) => setSelectedVendorKey(v ?? '')}
                        onClear={() => setSelectedVendorKey('')}
                      />
                    </Form.Item>

                    <Form.Item label={t('drawer.violence')} required className="mb-3">
                      <Select<'0' | '1'>
                        value={violence}
                        options={violenceOptions}
                        onChange={(v) => setViolence(v)}
                      />
                    </Form.Item>

                    <Form.Item label={t('drawer.courierId')} className="mb-3">
                      <Input
                        value={detectedDriverId}
                        onChange={(e) => {
                          setDetectedDriverId(e.target.value.trim())
                          setSelectedVendorKey('')
                          setVendorAutoFillTip('')
                          setPendingAutoResolveDriverId('')
                        }}
                        placeholder={t('drawer.courierIdPlaceholder')}
                        className="font-mono"
                      />
                    </Form.Item>
                  </div>

                  <Form.Item label={t('drawer.remark')} className="mb-3">
                    <Input.TextArea
                      rows={3}
                      value={closureRemark}
                      onChange={(e) => setClosureRemark(e.target.value)}
                      placeholder={t('drawer.remarkPlaceholder')}
                    />
                  </Form.Item>

                  {canSubmitClosure ? (
                    <Form.Item className="mb-0">
                      <Button
                        type="primary"
                        onClick={() => void handleSubmitClosure()}
                        loading={isSubmittingClosure}
                        disabled={isSubmittingClosure}
                        className="min-w-[120px]"
                      >
                        {t('drawer.addClosure')}
                      </Button>
                    </Form.Item>
                  ) : null}
                </Form>
              </div>
            </section>

            {/* Trace timeline */}
            <div className={`grid gap-4 ${hasInterceptLogs ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
              <section className="admin-panel flex min-h-[280px] flex-col overflow-hidden">
                <DrawerSectionHeader
                  icon={<Route className="h-4 w-4" aria-hidden />}
                  eyebrow={t('drawer.trackEyebrow')}
                  title={t('drawer.trackTitle')}
                  count={sortedTrackEvents.length}
                  entryCountLabel={entryCountLabel}
                />

                {sortedTrackEvents.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-slate-400">
                    {t('drawer.noTrackData')}
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(240,247,251,0.55),rgba(255,255,255,0.9))] px-4 py-2">
                    <Timeline
                      className="order-analysis-timeline order-analysis-timeline--compact"
                      items={sortedTrackEvents.map((evt) => {
                        const isLatestResponsibilityTrack =
                          latestResponsibilityMarker?.source === 'track' &&
                          latestResponsibilityMarker.time === evt.time
                        const stageColor = STAGE_DOT_COLOR[evt.trackStageTx ?? ''] ?? 'gray'
                        const dotColor = isLatestResponsibilityTrack ? 'red' : stageColor
                        const typeTagColor = evt.trackType ? TRACK_TYPE_COLORS[evt.trackType] : null
                        const typeTagLabel = evt.trackType
                          ? trackTypeLabels[evt.trackType as keyof typeof trackTypeLabels]
                          : null
                        return {
                          color: dotColor,
                          children: (
                            <div
                              className={`rounded-md px-2 py-1 transition ${
                                isLatestResponsibilityTrack
                                  ? 'bg-red-50/70'
                                  : 'hover:bg-white/80'
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`font-mono text-xs tabular-nums ${
                                    isLatestResponsibilityTrack ? 'text-red-600' : 'text-slate-500'
                                  }`}
                                >
                                  {evt.time}
                                </span>
                                {evt.trackStageTx ? (
                                  <Tag
                                    color={isLatestResponsibilityTrack ? 'red' : stageColor}
                                    className="m-0 border-0 text-[11px] leading-tight"
                                  >
                                    {evt.trackStageTx}
                                  </Tag>
                                ) : null}
                                {typeTagLabel ? (
                                  <Tag
                                    color={isLatestResponsibilityTrack ? 'red' : typeTagColor ?? 'default'}
                                    className="m-0 border-0 text-[11px] leading-tight"
                                  >
                                    {typeTagLabel}
                                  </Tag>
                                ) : null}
                                {isLatestResponsibilityTrack ? (
                                  <Tag color="red" className="m-0 border-0 text-[11px] leading-tight">
                                    {t('drawer.latestResponsibleParty')}
                                  </Tag>
                                ) : null}
                              </div>
                              <p
                                className={`mt-0.5 text-[13px] leading-snug ${
                                  isLatestResponsibilityTrack ? 'text-red-800' : 'text-slate-800'
                                }`}
                              >
                                {renderTrackContentWithDriverIdClickable(
                                  evt.content,
                                  handleTrackDriverIdPick,
                                  fillCourierTitle,
                                  evt.proofFileKeys,
                                  handleViewProof,
                                )}
                              </p>
                            </div>
                          ),
                        }
                      })}
                    />
                  </div>
                )}
              </section>

              {hasInterceptLogs ? (
                <section className="admin-panel flex min-h-[280px] flex-col overflow-hidden">
                  <DrawerSectionHeader
                    icon={<ShieldAlert className="h-4 w-4" aria-hidden />}
                    eyebrow={t('drawer.interceptEyebrow')}
                    title={t('drawer.interceptTitle')}
                    count={sortedInterceptLogs.length}
                    countTone="muted"
                    entryCountLabel={entryCountLabel}
                  />

                  <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
                    <Timeline
                      className="order-analysis-timeline"
                      items={sortedInterceptLogs.map((log) => {
                        const isLatestResponsibilityIntercept =
                          latestResponsibilityMarker?.source === 'intercept' &&
                          latestResponsibilityMarker.time === log.gmtIntercept
                        const scanUserCode = log.scanUserCode.trim()
                        return {
                          color: isLatestResponsibilityIntercept ? 'red' : 'gray',
                          children: (
                            <div
                              className={`px-1 py-1.5 ${
                                isLatestResponsibilityIntercept ? 'rounded-md bg-red-50/80' : ''
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`font-mono text-[11px] tabular-nums ${
                                    isLatestResponsibilityIntercept ? 'text-red-600' : 'text-slate-500'
                                  }`}
                                >
                                  {log.gmtScan || log.gmtIntercept}
                                </span>
                                <span className="font-semibold text-[12px]">{log.scanTypeDesc || '—'}</span>
                              </div>
                              <div
                                className={`mt-1.5 space-y-1 text-[12px] leading-5 ${
                                  isLatestResponsibilityIntercept ? 'text-red-800' : 'text-slate-800'
                                }`}
                              >
                                <p>
                                  <span className="text-slate-500">{t('drawer.scanHub')}</span>
                                  <span>{log.scanOcName || '—'}</span>
                                </p>
                                <p>
                                  <span className="text-slate-500">{t('drawer.interceptReason')}</span>
                                  <span>{log.interceptReasonDesc || '—'}</span>
                                </p>
                                <p>
                                  <span className="text-slate-500">{t('drawer.operator')}</span>
                                  <span className="font-medium">{log.scanUserName || '-'}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (scanUserCode) handleTrackDriverIdPick(scanUserCode)
                                    }}
                                    disabled={!scanUserCode}
                                    className={`ml-1 inline-flex items-center rounded px-0.5 py-0.5 font-mono text-[11px] underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:no-underline ${
                                      isLatestResponsibilityIntercept
                                        ? 'text-red-500 hover:bg-red-100/70 hover:text-red-600 disabled:text-red-300'
                                        : 'text-[#1f6f68] hover:bg-emerald-50 hover:text-[#2f8f87] disabled:text-slate-400'
                                    }`}
                                    title={
                                      scanUserCode
                                        ? fillCourierTitle(scanUserCode)
                                        : t('drawer.noCourierId')
                                    }
                                  >
                                    ({scanUserCode || '-'})
                                  </button>
                                </p>
                              </div>
                            </div>
                          ),
                        }
                      })}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <Modal
        open={proofPreview.open}
        onCancel={() => setProofPreview((prev) => ({ ...prev, open: false }))}
        footer={null}
        title={t('drawer.viewProofModalTitle')}
      >
        {proofPreview.loading ? (
          <div className="flex items-center justify-center py-10">
            <Spin />
            <span className="ml-2 text-sm text-slate-500">{t('drawer.viewProofLoading')}</span>
          </div>
        ) : proofPreview.error ? (
          <div className="py-6 text-center text-sm text-red-500">{proofPreview.error}</div>
        ) : (
          <Image.PreviewGroup>
            <div className="grid grid-cols-3 gap-2">
              {proofPreview.urls.map((url) => (
                <Image key={url} src={url} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
              ))}
            </div>
          </Image.PreviewGroup>
        )}
      </Modal>
      <Modal
        open={barcodeOpen}
        onCancel={() => setBarcodeOpen(false)}
        footer={null}
        title={t('drawer.barcodeModalTitle')}
        afterOpenChange={(visible) => {
          if (visible) drawBarcode()
        }}
      >
        <div className="flex items-center justify-center py-4">
          <svg ref={barcodeSvgRef} />
        </div>
      </Modal>
    </Drawer>
  )
}
