import { Alert, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { TrendingUp, Users, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { WaybillListPopover } from '../../../components/WaybillPopover'
import type { FetchedData } from '../useVendorAnalysisPage'
import type { DriverPerformanceRow, VendorMetricRow } from '../vendorAnalysisTypes'

type Props = {
  metrics: VendorMetricRow[]
  fetchedData: FetchedData
  hasStations: boolean
  driverPerformanceByVendor: Record<string, DriverPerformanceRow[]>
  /** 生效的指标 key（metricsRegistry），未包含的 KPI 卡/司机列不渲染 */
  enabledMetricKeys: ReadonlySet<string>
}

/** Tailwind 不能拼接动态类名，KPI 卡数量 → 桌面端列数用静态映射；所有指标可自由取消，数量可低至 0 */
const KPI_GRID_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
}

// ── 数据概览 KPI 卡片 ──────────────────────────────────────────────

function KpiCard({
  value,
  label,
  sub,
}: {
  value: React.ReactNode
  label: string
  sub?: React.ReactNode
}) {
  return (
    <div className="px-5 py-5 min-w-0">
      <div className="text-[26px] font-bold tabular-nums leading-tight">{value}</div>
      <div className="mt-1.5 text-[11px] text-slate-500 leading-snug">{label}</div>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  )
}

// ── 司机表格单元格 ─────────────────────────────────────────────────

function PickupChip({ count, waybillNos }: { count: number; waybillNos: string[] }) {
  const chip =
    count === 0 ? (
      <span className="text-sm text-slate-400">0</span>
    ) : (
      <span className="inline-flex min-w-[2.25rem] cursor-default items-center justify-center rounded-full bg-blue-50 px-3 py-0.5 text-sm font-semibold text-blue-600">
        {count}
      </span>
    )

  if (waybillNos.length === 0) return chip

  return (
    <WaybillListPopover nos={waybillNos} title="运单号" placement="right">
      {chip}
    </WaybillListPopover>
  )
}

function Before11RateBadge({
  rate,
  count,
  total,
  unmetWaybillNos = [],
}: {
  rate: number | null
  count: number
  total: number
  unmetWaybillNos?: string[]
}) {
  if (rate == null) return <span className="text-sm text-slate-400">—</span>
  const pct = (rate * 100).toFixed(1)
  const colorCls =
    rate >= 0.99
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : rate >= 0.95
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-red-50 border-red-200 text-red-700'
  return (
    <div>
      <WaybillListPopover nos={unmetWaybillNos} title="11点前未出仓单号" placement="right">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-bold ${colorCls}${unmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
          {pct}%
        </span>
      </WaybillListPopover>
      {total > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-400">{count}/{total} 件</div>
      )}
    </div>
  )
}

function DispatchRateBadge({
  rate,
  count,
  total,
  unmetWaybillNos = [],
}: {
  rate: number | null
  count: number
  total: number
  unmetWaybillNos?: string[]
}) {
  if (rate == null) return <span className="text-sm text-slate-400">—</span>
  const pct = (rate * 100).toFixed(1)
  const colorCls =
    rate >= 0.95
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : rate >= 0.92
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-red-50 border-red-200 text-red-700'
  return (
    <div>
      <WaybillListPopover nos={unmetWaybillNos} title="24H未达标单号" placement="right">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-bold ${colorCls}${unmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
          {pct}%
        </span>
      </WaybillListPopover>
      {total > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-400">{count}/{total} 件</div>
      )}
    </div>
  )
}

function WarningCount({ count, waybillNos = [] }: { count: number; waybillNos?: string[] }) {
  if (count === 0)
    return (
      <span className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-600">
        0
      </span>
    )
  const badge = (
    <span className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-red-50 px-2.5 py-0.5 text-sm font-semibold text-red-600${waybillNos.length > 0 ? ' cursor-help' : ''}`}>
      {count}
    </span>
  )
  if (waybillNos.length === 0) return badge
  return (
    <WaybillListPopover nos={waybillNos} title="归班预警记录" placement="right">
      {badge}
    </WaybillListPopover>
  )
}

/** 司机表格列按勾选过滤；「司机」为身份列恒显示，其余均可自由取消 */
function buildDriverColumns(enabled: ReadonlySet<string>): ColumnsType<DriverPerformanceRow> {
  const todayPickupEnabled = enabled.has('driver.todayPickup')
  const dispatch24hEnabled = enabled.has('driver.dispatch24h')
  const returnWarningEnabled = enabled.has('driver.returnWarning')
  // 默认排序列优先级：归班预警 > 今日取件 > 24H派签率；都被取消则不设默认排序
  const defaultSortKey = returnWarningEnabled ? null : todayPickupEnabled ? 'ofdCount' : dispatch24hEnabled ? 'dispatchRate24h' : null
  return [
    {
      title: '司机',
      key: 'courier',
      width: 190,
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-800">{row.courierName || '—'}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            <span className="font-mono text-slate-400">{row.courierCode}</span>
            {row.routeCode ? (
              <>
                <span className="text-slate-300" aria-hidden>
                  ·
                </span>
                <span className="font-medium text-indigo-600">{row.routeCode}</span>
              </>
            ) : null}
          </div>
        </div>
      ),
    },
    ...(todayPickupEnabled
      ? ([
          {
            title: '今日取件',
            dataIndex: 'ofdCount',
            key: 'ofdCount',
            width: 110,
            ...(defaultSortKey === 'ofdCount' ? { defaultSortOrder: 'descend' as const } : {}),
            sorter: (a, b) => a.ofdCount - b.ofdCount,
            render: (v: number, row) => <PickupChip count={v} waybillNos={row.ofdWaybillNos} />,
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(enabled.has('driver.before11ExitRate')
      ? ([
          {
            title: '11点前出仓率',
            key: 'before11Rate',
            width: 140,
            sorter: (a, b) =>
              (a.before11TotalCount > 0 ? a.before11OfdCount / a.before11TotalCount : -1) -
              (b.before11TotalCount > 0 ? b.before11OfdCount / b.before11TotalCount : -1),
            render: (_, row) => (
              <Before11RateBadge
                rate={row.before11TotalCount > 0 ? row.before11OfdCount / row.before11TotalCount : null}
                count={row.before11OfdCount}
                total={row.before11TotalCount}
                unmetWaybillNos={row.before11UnmetWaybillNos}
              />
            ),
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(dispatch24hEnabled
      ? ([
          {
            title: '24H派签率',
            key: 'dispatchRate24h',
            width: 140,
            ...(defaultSortKey === 'dispatchRate24h' ? { defaultSortOrder: 'descend' as const } : {}),
            sorter: (a, b) => (a.dispatchRate24h ?? -1) - (b.dispatchRate24h ?? -1),
            render: (_, row) => (
              <DispatchRateBadge
                rate={row.dispatchRate24h}
                count={row.dispatch24hCount}
                total={row.totalDispatchCount}
                unmetWaybillNos={row.dispatch24hUnmetWaybillNos}
              />
            ),
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(returnWarningEnabled
      ? ([
          {
            title: '归班预警',
            dataIndex: 'returnWarningCount',
            key: 'returnWarningCount',
            width: 110,
            defaultSortOrder: 'descend' as const,
            sorter: (a, b) => a.returnWarningCount - b.returnWarningCount,
            render: (v: number, row) => <WarningCount count={v} waybillNos={row.returnWarningWaybillNos} />,
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(enabled.has('driver.longTail')
      ? ([
          {
            title: '长尾单',
            dataIndex: 'longTailCount',
            key: 'longTailCount',
            width: 100,
            sorter: (a, b) => a.longTailCount - b.longTailCount,
            render: (v: number, row) => {
              if (v === 0) return <span className="text-sm text-slate-400">0</span>
              const badge = (
                <span className="inline-flex min-w-[2.25rem] cursor-help items-center justify-center rounded-full bg-amber-50 px-2.5 py-0.5 text-sm font-semibold text-amber-600">
                  {v}
                </span>
              )
              if (row.longTailWaybillNos.length === 0) return badge
              return (
                <WaybillListPopover nos={row.longTailWaybillNos} title="长尾单单号" placement="right">
                  {badge}
                </WaybillListPopover>
              )
            },
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
  ]
}

// ── 单个供应商卡片 ─────────────────────────────────────────────────

type VendorCardProps = {
  row: VendorMetricRow
  fetchedData: FetchedData
  drivers: DriverPerformanceRow[]
  enabledMetricKeys: ReadonlySet<string>
  driverColumns: ColumnsType<DriverPerformanceRow>
}

function VendorCard({ row, fetchedData, drivers, enabledMetricKeys, driverColumns }: VendorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [driversExpanded, setDriversExpanded] = useState(true)
  const fmt = (s: string) => s.slice(0, 10)

  // 11点前出仓率
  const exitRate = row.before11ExitRate
  const exitColor =
    exitRate == null
      ? 'text-slate-300'
      : exitRate >= 0.99
        ? 'text-emerald-600'
        : exitRate >= 0.95
          ? 'text-amber-500'
          : 'text-red-600'

  // 24H派签率
  const dispatchRateNum = row.dispatchRate24hText ? parseFloat(row.dispatchRate24hText) : null
  const dispatchTextColor =
    dispatchRateNum == null
      ? 'text-slate-300'
      : dispatchRateNum >= 95
        ? 'text-emerald-600'
        : dispatchRateNum >= 92
          ? 'text-amber-500'
          : 'text-red-600'

  // 客诉率
  const cr = row.complaintRate
  const crColor =
    cr >= 0.0003 ? 'text-red-600' : cr >= 0.00025 ? 'text-amber-500' : 'text-emerald-600'

  const showBefore11 = enabledMetricKeys.has('vendor.before11ExitRate')
  const showDispatch24h = enabledMetricKeys.has('vendor.dispatch24h')
  const showComplaintRate = enabledMetricKeys.has('vendor.complaintRate')
  const showUnprocessed = enabledMetricKeys.has('vendor.unprocessedTickets')
  const showVendorLongTail = enabledMetricKeys.has('vendor.longTail')
  const showReturnWarning = enabledMetricKeys.has('driver.returnWarning')
  const kpiCount =
    (showBefore11 ? 1 : 0) +
    (showDispatch24h ? 1 : 0) +
    (showComplaintRate ? 1 : 0) +
    (showUnprocessed ? 1 : 0) +
    (showVendorLongTail ? 1 : 0)
  const totalReturnWarning = drivers.reduce((s, d) => s + d.returnWarningCount, 0)
  const lowDispatchDrivers = drivers
    .filter((d) => d.dispatchRate24h != null && d.dispatchRate24h < 0.92)
    .sort((a, b) => (a.dispatchRate24h ?? 1) - (b.dispatchRate24h ?? 1))
  const warningDriver = lowDispatchDrivers[0] ?? null

  return (
    <div>
      {/* ── 供应商标题行（点击展开/折叠整张卡片） ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 bg-[var(--admin-surface-soft)] px-5 py-2.5 text-left transition-colors hover:bg-slate-100"
      >
        <span className="text-sm font-semibold text-slate-800">{row.supplierNickname || row.vendorName}</span>
        <span className="text-xs text-slate-400">{row.vendorName} · {row.vendorCode}</span>
        {row.sharedVendorCode && (
          <Tooltip title={`供应商编码 ${row.vendorCode} 下有多家供应商（按路由码区分）。客诉、未处理工单的原始数据只有编码、没有路由码，无法拆分到各家，因此这两项及客诉率显示的是该编码的合计值，多家相加会重复计数。揽收量、11点前出仓、24H派签均已按路由码拆分到本家。`}>
            <span className="cursor-help rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
              编码共用
            </span>
          </Tooltip>
        )}
        <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-slate-400">
          数据概览
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <>
          {/* ── 数据概览：KPI 卡片行（所有指标均可取消，全部取消时不渲染） ── */}
          {kpiCount > 0 && (
            <div
              className={`grid grid-cols-2 divide-x divide-y divide-[var(--admin-line)] border-b border-[var(--admin-line)] ${KPI_GRID_COLS[kpiCount]} sm:divide-y-0`}
            >
            {showBefore11 && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.before11UnmetWaybillNos} title="11点前未出仓单号" placement="bottom">
                    <span className={`${exitColor}${row.before11UnmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                      {exitRate != null ? `${(exitRate * 100).toFixed(1)}%` : '—'}
                    </span>
                  </WaybillListPopover>
                }
                label={`11点前出仓率 · 截至 ${fmt(fetchedData.before11Date)}`}
                sub={
                  row.before11ExitVolume != null && row.before11TotalReceived != null ? (
                    <span className="text-[11px] text-slate-400">
                      {row.before11ExitVolume} / {row.before11TotalReceived} 件
                    </span>
                  ) : undefined
                }
              />
            )}

            {showDispatch24h && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.dispatch24hUnmetWaybillNos} title="24H未达标单号" placement="bottom">
                    <span className={`${dispatchTextColor}${row.dispatch24hUnmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                      {row.dispatchRate24hText ?? '—'}
                    </span>
                  </WaybillListPopover>
                }
                label={`24H派签率 · ${fetchedData.dayBeforeDate}`}
                sub={
                  row.notMet24hSignCount != null && row.notMet24hSignCount > 0 ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      {row.notMet24hSignCount} 票未达标
                    </span>
                  ) : undefined
                }
              />
            )}

            {showComplaintRate && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.complaintOrderCodes} title="客诉单号" placement="bottom">
                    <span className={`${crColor}${row.complaintOrderCodes.length > 0 ? ' cursor-help' : ''}`}>
                      {(cr * 100).toFixed(3)}%
                    </span>
                  </WaybillListPopover>
                }
                label={`客诉率 · ${fmt(fetchedData.ticketStartTime)}~${fmt(fetchedData.ticketEndTime)}`}
                sub={
                  row.complaintCount > 0 ? (
                    <span className="text-[11px] text-slate-400">
                      {row.complaintCount} 件 · 揽收 {row.waybillCount} 件
                      {row.sharedVendorCode && (
                        <span className="text-amber-600">（客诉与客诉率按编码合计）</span>
                      )}
                    </span>
                  ) : undefined
                }
              />
            )}

            {showUnprocessed && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.unprocessedTicketOrderCodes} title="未处理工单单号" placement="bottom">
                    <span className={`${row.unprocessedTicketCount > 0 ? 'text-red-600' : 'text-slate-400'}${row.unprocessedTicketOrderCodes.length > 0 ? ' cursor-help' : ''}`}>
                      {row.unprocessedTicketCount}
                    </span>
                  </WaybillListPopover>
                }
                label="未处理工单（件）"
                sub={
                  row.unprocessedTicketCount > 0 ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      需及时处理
                      {row.sharedVendorCode && (
                        <span className="font-normal text-amber-600">（按编码合计）</span>
                      )}
                    </span>
                  ) : undefined
                }
              />
            )}

            {showVendorLongTail && (
              <KpiCard
                value={
                  <span className={row.longTailCount > 0 ? 'text-amber-500' : 'text-slate-400'}>
                    {row.longTailCount}
                  </span>
                }
                label="长尾单（件）"
              />
            )}
            </div>
          )}

          {/* ── 司机派件表现 ── */}
          <div>
            {/* 子标题 + 汇总徽章 + 折叠按钮 */}
            <button
              type="button"
              onClick={() => setDriversExpanded((v) => !v)}
              className="flex w-full flex-wrap items-center gap-2 border-b border-[var(--admin-line)] px-5 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                司机派件表现
              </span>

              <div className="ml-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  ⚠ 全员汇总
                </span>
                {showReturnWarning && totalReturnWarning > 0 && (
                  <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    归班预警 {totalReturnWarning}
                  </span>
                )}
                {lowDispatchDrivers.length > 0 && (
                  <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                    派签未达标 {lowDispatchDrivers.length} 人
                  </span>
                )}
              </div>

              <span className="ml-auto text-xs text-slate-400">{drivers.length} 位派件员</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
                  driversExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>

            {driversExpanded && (
              <div>
                {warningDriver && (
                  <div className="mx-5 mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <span className="mt-0.5 shrink-0 text-base leading-none">📋</span>
                    <div>
                      <div className="text-xs font-semibold text-amber-900">近期表现预警</div>
                      <div className="mt-0.5 text-xs text-amber-800">
                        派件员{' '}
                        <span className="font-semibold">
                          {warningDriver.courierName || warningDriver.courierCode}
                        </span>{' '}
                        24H派签率{' '}
                        <span className="font-semibold text-red-600">
                          {warningDriver.dispatchRate24h != null
                            ? `${(warningDriver.dispatchRate24h * 100).toFixed(1)}%`
                            : '—'}
                        </span>
                        ，持续低于达标线（92%）
                        {lowDispatchDrivers.length > 1 && (
                          <span className="ml-1 text-amber-700">等 {lowDispatchDrivers.length} 人</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="px-5 py-4 [&_.ant-table-thead_th]:!py-2 [&_.ant-table-tbody_td]:!py-2.5 [&_.ant-table-thead_th]:!px-3 [&_.ant-table-tbody_td]:!px-3">
                  {drivers.length === 0 ? (
                    <p className="py-2 text-xs text-slate-400">暂无司机数据</p>
                  ) : (
                    <Table<DriverPerformanceRow>
                      rowKey="courierCode"
                      columns={driverColumns}
                      dataSource={drivers}
                      pagination={false}
                      scroll={{ x: 690 }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────

export function VendorMetricsPreview({
  metrics,
  fetchedData,
  hasStations,
  driverPerformanceByVendor,
  enabledMetricKeys,
}: Props) {
  const driverColumns = useMemo(() => buildDriverColumns(enabledMetricKeys), [enabledMetricKeys])

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex flex-wrap items-center gap-3 bg-[var(--admin-surface-soft)]">
        <div>
          <div className="admin-eyebrow">Preview</div>
          <h3 className="admin-title mt-0.5 flex items-center gap-1.5 text-base">
            <TrendingUp className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            指标预览
          </h3>
        </div>
        <div className="ml-auto text-xs text-slate-500">
          确认数据无误后，点击上方「截图并推送到飞书」发送至已启用的供应商群
        </div>
      </div>

      {!hasStations && (
        <div className="border-b border-[var(--admin-line)] px-5 py-3">
          <Alert
            type="warning"
            showIcon
            message="未选择责任站点，客诉成立量以全部站点计算，推送时仍以所选站点过滤"
            className="text-xs"
          />
        </div>
      )}

      <div className="divide-y divide-[var(--admin-line)]">
        {metrics.map((row) => (
          <VendorCard
            key={row.id}
            row={row}
            fetchedData={fetchedData}
            drivers={driverPerformanceByVendor[row.supplierKey] ?? []}
            enabledMetricKeys={enabledMetricKeys}
            driverColumns={driverColumns}
          />
        ))}
        {metrics.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-slate-400">暂无供应商数据</div>
        )}
      </div>
    </div>
  )
}
