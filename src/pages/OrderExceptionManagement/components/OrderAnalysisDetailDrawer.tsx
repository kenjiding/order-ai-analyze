import { Button, Drawer, Form, Input, Select, Tag, Timeline } from 'antd'
import {
  AlertTriangle,
  Building2,
  ClipboardCheck,
  MapPin,
  Package,
  Route,
  ShieldAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DrawerCloseButton } from '../../../components/Drawer/DrawerCloseButton'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { showToast } from '../../../utils/toast'
import {
  getClosureVendors,
  postClosureDriverVendor,
  type ClosureExceptionTypeOption,
  type ClosureVendorOption,
  type OrderAnalyzeInterceptLog,
} from '../orderExceptionApi'
import type { TrackEvent } from '../types'
import type { OrderQueryInfo } from '../orderExceptionApi'
import type { AnalysisRow } from '../useOrderExceptionManagementPage'

type Row = AnalysisRow
type ClosureExceptionTypeKey = ClosureExceptionTypeOption['key']

const CLOSURE_EXCEPTION_TYPE_OPTIONS: ClosureExceptionTypeOption[] = [
  { key: 'aus_Packet_loss_in_the_station', value: '库内丢包', label: null },
  { key: 'aus_packet_loss_out_the_station', value: '库外丢包', label: null },
  { key: 'aus_Theft_and_robbery', value: '盗抢', label: null },
  { key: 'aus_Damaged_before_entering_the_station', value: '入站前破损', label: null },
  { key: 'aus_Empty_package_before_entering_the_station', value: '入站前空包', label: null },
  { key: 'aus_3PL_lost_items', value: '3PL丢件', label: null },
]

const CLOSURE_TYPE_VALUE_BY_KEY = new Map(CLOSURE_EXCEPTION_TYPE_OPTIONS.map((x) => [x.key, x.value]))

const STAGE_DOT_COLOR: Record<string, string> = {
  订单提交: 'blue',
  已揽件: 'cyan',
  转运: 'purple',
  派送: 'green',
}

const TRACK_TYPE_TAG: Record<string, { color: string; label: string }> = {
  Schedule: { color: 'processing', label: '预约派送' },
  Problem: { color: 'error', label: '问题件' },
  Delivery: { color: 'success', label: '派送中' },
}

type ClosureVendorMemoryCache = {
  vendors: ClosureVendorOption[]
  defaultStationCode: string
}

let closureVendorMemoryCache: ClosureVendorMemoryCache | null = null

const TRACK_DRIVER_ID_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)/gi

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
  onPickDriverId: (driverId: string) => void
): ReactNode {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let matched = false

  for (const match of content.matchAll(TRACK_DRIVER_ID_RE)) {
    const index = match.index ?? 0
    const fullText = match[0]
    const driverId = match[1]?.trim() ?? ''
    if (!driverId) continue
    matched = true

    if (index > lastIndex) nodes.push(content.slice(lastIndex, index))

    nodes.push(
      <button
        key={`${index}-${driverId}`}
        type="button"
        onClick={() => onPickDriverId(driverId)}
        className="mx-0.5 inline-flex items-center rounded px-1 py-0.5 font-mono text-[12px] font-semibold text-[#1f6f68] underline decoration-dotted underline-offset-2 hover:bg-emerald-50 hover:text-[#2f8f87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8f87]/30"
        title={`点击回填派送员 ID：${driverId}`}
      >
        {fullText}
      </button>
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
    orderInfo.totalWeight,
    orderInfo.customerDeclaredValueAud,
    orderInfo.declaredValueUsd,
  ].some((v) => String(v ?? '').trim() !== '')
}

function OrderInfoMetaLine({ orderInfo }: { orderInfo: OrderQueryInfo | null | undefined }) {
  if (!hasOrderInfoContent(orderInfo)) return null

  const items: { label: string; value: string }[] = [
    { label: '商家', value: formatOrderInfoField(orderInfo?.merchantName) },
    { label: '编码', value: formatOrderInfoField(orderInfo?.merchantCode) },
    { label: '重量kg', value: formatOrderInfoField(orderInfo?.totalWeight) },
    { label: '上传申报AUD', value: formatOrderInfoField(orderInfo?.customerDeclaredValueAud) },
    { label: '系统申报USD', value: formatOrderInfoField(orderInfo?.declaredValueUsd) },
  ].filter((item) => item.value !== '—')

  if (!items.length) return null

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-white/10 pt-2.5 text-sm leading-snug text-white/85">
      {items.map((item, index) => (
        <span key={item.label} className="inline-flex min-w-0 items-center gap-x-2">
          {index > 0 ? <span className="text-white/25" aria-hidden>·</span> : null}
          <span className="min-w-0 truncate">
            <span className="text-white/50">{item.label}</span>{': '}
            <span className="font-semibold text-white/95">{item.value}</span>
          </span>
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
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  count?: number
  countTone?: 'default' | 'muted'
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
          {count} 条
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
  const { imileToken } = useAppSettings()

  const [closureTypeKey, setClosureTypeKey] = useState<ClosureExceptionTypeKey | ''>('')
  const [closureRemark, setClosureRemark] = useState('')
  const [stationCode, setStationCode] = useState('')
  const [vendorOptions, setVendorOptions] = useState<ClosureVendorOption[]>([])
  const [selectedVendorKey, setSelectedVendorKey] = useState('')
  const [detectedDriverId, setDetectedDriverId] = useState('')
  const [pendingAutoResolveDriverId, setPendingAutoResolveDriverId] = useState('')
  const [vendorAutoFillTip, setVendorAutoFillTip] = useState('')
  const [submitPreview, setSubmitPreview] = useState('')
  const [isLoadingVendors, setIsLoadingVendors] = useState(false)
  const [isResolvingVendor, setIsResolvingVendor] = useState(false)

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
      setStationCode('')
      setVendorOptions([])
      setSelectedVendorKey('')
      setDetectedDriverId('')
      setPendingAutoResolveDriverId('')
      setVendorAutoFillTip('')
      setSubmitPreview('')
      return
    }

    const inferred = inferClosureExceptionTypeKey(row)
    setClosureTypeKey(inferred ?? '')
    setClosureRemark(row.reason || '')
    setSelectedVendorKey('')
    setSubmitPreview('')
    setVendorAutoFillTip('')
    setDetectedDriverId(row.detectedDriverId ?? '')
    setPendingAutoResolveDriverId(row.detectedDriverId ?? '')
  }, [row])

  const loadClosureVendors = useCallback(async () => {
    const token = imileToken.trim()
    if (!row || !token) return

    if (closureVendorMemoryCache) {
      setVendorOptions(closureVendorMemoryCache.vendors)
      if (!stationCode.trim()) setStationCode(closureVendorMemoryCache.defaultStationCode || '')
      return
    }

    setIsLoadingVendors(true)
    try {
      const { vendors, defaultStationCode } = await getClosureVendors({ imileToken: token })
      closureVendorMemoryCache = { vendors, defaultStationCode }
      setVendorOptions(vendors)
      if (!stationCode.trim()) setStationCode(defaultStationCode || '')
    } catch (e) {
      showToast((e as Error).message || '供应商列表加载失败', 'error')
    } finally {
      setIsLoadingVendors(false)
    }
  }, [row, imileToken, stationCode])

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
          setVendorAutoFillTip('未查询到司机供应商，请手动选择。')
          return
        }

        setVendorAutoFillTip('')
        setVendorOptions((prev) => {
          const exists = prev.some((x) => x.key === result.vendorCode)
          if (exists) return prev
          const next = [...prev, { key: result.vendorCode, value: result.vendorName, label: null }]
          if (closureVendorMemoryCache) {
            closureVendorMemoryCache = { ...closureVendorMemoryCache, vendors: next }
          }
          return next
        })
        setSelectedVendorKey(result.vendorCode)
      } catch (e) {
        setVendorAutoFillTip('供应商自动识别失败，请手动选择。')
        showToast((e as Error).message || '司机供应商识别失败', 'error')
      } finally {
        setIsResolvingVendor(false)
      }
    },
    [imileToken]
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

  const handlePreviewSubmit = useCallback(() => {
    if (!row) return

    const selectedTypeKey = closureTypeKey.trim() as ClosureExceptionTypeKey | ''
    if (!selectedTypeKey) {
      showToast('请先选择异常类型', 'error')
      return
    }

    if (outResponsibility && !selectedVendorKey.trim()) {
      showToast('当前为库外责任，请选择派件员供应商', 'error')
      return
    }

    const vendor = vendorOptions.find((x) => x.key === selectedVendorKey)
    const payload = {
      orderNo: row.orderNo,
      exceptionType: {
        key: selectedTypeKey,
        value: CLOSURE_TYPE_VALUE_BY_KEY.get(selectedTypeKey) ?? '',
      },
      remark: closureRemark.trim(),
      deliverySupplier: vendor
        ? { vendorCode: vendor.key, vendorName: vendor.value }
        : null,
      stationCode: stationCode.trim() || null,
      driverId: detectedDriverId || null,
      aiResult: {
        lossScope: row.lossScope,
        subType: row.categoryName,
        responsibilityParty: row.currentResponsibilityParty,
        reason: row.reason,
        confidence: row.confidence,
      },
    }

    setSubmitPreview(JSON.stringify(payload, null, 2))
    showToast('已生成提交预览（未实际调用闭环接口）', 'success')
  }, [
    closureRemark,
    closureTypeKey,
    detectedDriverId,
    row,
    outResponsibility,
    selectedVendorKey,
    stationCode,
    vendorOptions,
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
                      需人工复核
                    </span>
                  ) : null}
                  {outResponsibility ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-200/35 bg-orange-400/20 px-2.5 py-1 text-[11px] font-semibold text-orange-50">
                      <ShieldAlert className="h-3 w-3" aria-hidden />
                      库外责任
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 backdrop-blur-sm">
                      <Package className="h-5 w-5 text-white" aria-hidden />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">订单号</p>
                      <p className="font-mono text-xl font-semibold tracking-wide text-white sm:text-2xl">{row.orderNo}</p>
                    </div>
                  </div>
                  <div className="hidden h-8 w-px bg-white/20 sm:block" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">异常分类</p>
                    <p className="truncate text-sm font-medium text-white/95">
                      {row.lossScope}
                      <span className="mx-2 text-white/40">/</span>
                      {row.categoryName}
                    </p>
                  </div>
                  <div className="hidden h-8 w-px bg-white/20 sm:block" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">当前责任站点</p>
                    <p className="truncate text-sm font-semibold text-white/95">{row.currentResponsibilityParty || '—'}</p>
                  </div>
                  <div className="hidden h-8 w-px bg-white/20 sm:block" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/70">置信度</p>
                    <p className="truncate text-sm font-medium text-white/95">{String(row.confidence ?? '—')}</p>
                  </div>
                </div>

                <OrderInfoMetaLine orderInfo={row.orderInfo} />
              </div>

              <DrawerCloseButton onClick={onClose} variant="onDark" aria-label="关闭订单详情" />
            </div>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {/* Closure + vendor */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <section className="admin-panel overflow-hidden">
                <DrawerSectionHeader
                  icon={<ClipboardCheck className="h-4 w-4" aria-hidden />}
                  eyebrow="Exception Closure"
                  title="异常完结"
                />
                <div className="px-5 py-4">
                  <Form layout="vertical" colon={false}>
                    <div className="grid gap-x-4 sm:grid-cols-2">
                      <Form.Item label="异常类型" required className="mb-3">
                        <Select<ClosureExceptionTypeKey>
                          value={closureTypeKey || undefined}
                          placeholder="请选择异常类型"
                          options={CLOSURE_EXCEPTION_TYPE_OPTIONS.map((x) => ({
                            value: x.key,
                            label: x.value,
                          }))}
                          onChange={(v) => setClosureTypeKey(v)}
                        />
                      </Form.Item>

                      <Form.Item
                        label="派件员供应商"
                        required={outResponsibility}
                        className="mb-3"
                        extra={vendorAutoFillTip || undefined}
                      >
                        <Select<string>
                          value={selectedVendorKey || undefined}
                          placeholder={isLoadingVendors ? '加载中...' : '请选择供应商'}
                          showSearch
                          allowClear
                          loading={isLoadingVendors}
                          options={vendorSelectOptions}
                          optionFilterProp="label"
                          onChange={(v) => setSelectedVendorKey(v ?? '')}
                          onClear={() => setSelectedVendorKey('')}
                        />
                      </Form.Item>
                    </div>

                    <Form.Item label="备注" className="mb-3">
                      <Input.TextArea
                        rows={3}
                        value={closureRemark}
                        onChange={(e) => setClosureRemark(e.target.value)}
                        placeholder="默认回填 AI 判定依据"
                      />
                    </Form.Item>

                    <Form.Item className="mb-0">
                      <Button type="primary" onClick={handlePreviewSubmit} className="min-w-[120px]">
                        提交预览
                      </Button>
                    </Form.Item>
                  </Form>

                  {submitPreview ? (
                    <div className="mt-4 overflow-hidden rounded-lg border border-slate-700/30 bg-[linear-gradient(180deg,#1e293b_0%,#0f172a_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <div className="border-b border-white/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Submit Payload Preview
                      </div>
                      <pre className="max-h-48 overflow-auto px-4 py-3 text-xs leading-relaxed text-slate-100">
                        {submitPreview}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-[#c8deee] bg-[linear-gradient(180deg,#f8fcff_0%,#eef7fb_100%)] shadow-[0_18px_48px_rgba(47,83,105,0.07)]">
                <DrawerSectionHeader
                  icon={<Building2 className="h-4 w-4" aria-hidden />}
                  eyebrow="Vendor Resolution"
                  title="供应商识别"
                />
                <div className="px-5 py-4">
                  <Form layout="vertical" colon={false}>
                    <Form.Item label="站点编码" className="mb-3">
                      <Input
                        value={stationCode}
                        onChange={(e) => setStationCode(e.target.value.trim())}
                        placeholder="例如：S210372901"
                        prefix={<MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden />}
                      />
                    </Form.Item>

                    <Form.Item label="派送员 ID" className="mb-3">
                      <Input
                        value={detectedDriverId}
                        onChange={(e) => {
                          setDetectedDriverId(e.target.value.trim())
                          setSelectedVendorKey('')
                          setVendorAutoFillTip('')
                          setPendingAutoResolveDriverId('')
                        }}
                        placeholder="可手动输入或从轨迹点选"
                        className="font-mono"
                      />
                    </Form.Item>

                    <Form.Item className="mb-0">
                      <Button
                        block
                        type="default"
                        disabled={!detectedDriverId || !stationCode || isResolvingVendor}
                        loading={isResolvingVendor}
                        onClick={() =>
                          detectedDriverId ? void resolveVendorByDriver(detectedDriverId, stationCode) : undefined
                        }
                      >
                        识别供应商
                      </Button>
                    </Form.Item>
                  </Form>
                </div>
              </section>
            </div>

            {/* Trace timeline */}
            <div className={`grid gap-4 ${hasInterceptLogs ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
              <section className="admin-panel flex min-h-[280px] flex-col overflow-hidden">
                <DrawerSectionHeader
                  icon={<Route className="h-4 w-4" aria-hidden />}
                  eyebrow="Track Intelligence"
                  title="Query 完整轨迹"
                  count={sortedTrackEvents.length}
                />

                {sortedTrackEvents.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-slate-400">
                    暂无轨迹数据
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
                        const typeTag = evt.trackType ? TRACK_TYPE_TAG[evt.trackType] : null
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
                                {typeTag ? (
                                  <Tag
                                    color={isLatestResponsibilityTrack ? 'red' : typeTag.color}
                                    className="m-0 border-0 text-[11px] leading-tight"
                                  >
                                    {typeTag.label}
                                  </Tag>
                                ) : null}
                                {isLatestResponsibilityTrack ? (
                                  <Tag color="red" className="m-0 border-0 text-[11px] leading-tight">
                                    最新责任方
                                  </Tag>
                                ) : null}
                              </div>
                              <p
                                className={`mt-0.5 text-[13px] leading-snug ${
                                  isLatestResponsibilityTrack ? 'text-red-800' : 'text-slate-800'
                                }`}
                              >
                                {renderTrackContentWithDriverIdClickable(evt.content, handleTrackDriverIdPick)}
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
                    eyebrow="Intercept Audit"
                    title="完整阻断日志"
                    count={sortedInterceptLogs.length}
                    countTone="muted"
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
                                  <span className="text-slate-500">扫描网点：</span>
                                  <span>{log.scanOcName || '—'}</span>
                                </p>
                                <p>
                                  <span className="text-slate-500">阻断原因：</span>
                                  <span>{log.interceptReasonDesc || '—'}</span>
                                </p>
                                <p>
                                  <span className="text-slate-500">操作人：</span>
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
                                    title={scanUserCode ? `点击回填派送员 ID：${scanUserCode}` : '无派送员 ID'}
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
    </Drawer>
  )
}
