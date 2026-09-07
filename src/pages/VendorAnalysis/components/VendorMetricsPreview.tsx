import { Alert, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { TFunction } from 'i18next'
import { TrendingUp, Users, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WaybillListPopover } from '../../../components/WaybillPopover'
import type { FetchedData } from '../useVendorAnalysisPage'
import type { DriverPerformanceRow, VendorMetricRow } from '../vendorAnalysisTypes'

type Props = {
  metrics: VendorMetricRow[]
  fetchedData: FetchedData
  hasStations: boolean
  driverPerformanceByVendor: Record<string, DriverPerformanceRow[]>
  enabledMetricKeys: ReadonlySet<string>
}

const KPI_GRID_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
}

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

function PickupChip({ count, waybillNos, title }: { count: number; waybillNos: string[]; title: string }) {
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
    <WaybillListPopover nos={waybillNos} title={title} placement="right">
      {chip}
    </WaybillListPopover>
  )
}

function Before11RateBadge({
  rate,
  total,
  unmetWaybillNos = [],
  unmetTitle,
  countLabel,
}: {
  rate: number | null
  count: number
  total: number
  unmetWaybillNos?: string[]
  unmetTitle: string
  countLabel: string
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
      <WaybillListPopover nos={unmetWaybillNos} title={unmetTitle} placement="right">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-bold ${colorCls}${unmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
          {pct}%
        </span>
      </WaybillListPopover>
      {total > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-400">{countLabel}</div>
      )}
    </div>
  )
}

function DispatchRateBadge({
  rate,
  total,
  unmetWaybillNos = [],
  unmetTitle,
  countLabel,
}: {
  rate: number | null
  count: number
  total: number
  unmetWaybillNos?: string[]
  unmetTitle: string
  countLabel: string
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
      <WaybillListPopover nos={unmetWaybillNos} title={unmetTitle} placement="right">
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-bold ${colorCls}${unmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
          {pct}%
        </span>
      </WaybillListPopover>
      {total > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-400">{countLabel}</div>
      )}
    </div>
  )
}

function WarningCount({ count, waybillNos = [], title }: { count: number; waybillNos?: string[]; title: string }) {
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
    <WaybillListPopover nos={waybillNos} title={title} placement="right">
      {badge}
    </WaybillListPopover>
  )
}

function buildDriverColumns(
  enabled: ReadonlySet<string>,
  t: TFunction<'vendorAnalysis'>,
  tc: TFunction<'common'>,
): ColumnsType<DriverPerformanceRow> {
  const countLabel = (count: number, total: number) =>
    `${t('countOfTotal', { count, total })} ${tc('pieces')}`

  const todayPickupEnabled = enabled.has('driver.todayPickup')
  const dispatch24hEnabled = enabled.has('driver.dispatch24h')
  const returnWarningEnabled = enabled.has('driver.returnWarning')
  const defaultSortKey = returnWarningEnabled ? null : todayPickupEnabled ? 'ofdCount' : dispatch24hEnabled ? 'dispatchRate24h' : null

  return [
    {
      title: t('metricCategory.driver'),
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
            title: t('metrics.driver.todayPickup'),
            dataIndex: 'ofdCount',
            key: 'ofdCount',
            width: 110,
            ...(defaultSortKey === 'ofdCount' ? { defaultSortOrder: 'descend' as const } : {}),
            sorter: (a, b) => a.ofdCount - b.ofdCount,
            render: (v: number, row) => (
              <PickupChip count={v} waybillNos={row.ofdWaybillNos} title={t('waybillTitles.waybillNo')} />
            ),
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(enabled.has('driver.before11ExitRate')
      ? ([
          {
            title: t('metrics.driver.before11ExitRate'),
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
                unmetTitle={t('waybillTitles.before11Unmet')}
                countLabel={countLabel(row.before11OfdCount, row.before11TotalCount)}
              />
            ),
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(dispatch24hEnabled
      ? ([
          {
            title: t('metrics.driver.dispatch24h'),
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
                unmetTitle={t('waybillTitles.dispatch24hUnmet')}
                countLabel={countLabel(row.dispatch24hCount, row.totalDispatchCount)}
              />
            ),
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(returnWarningEnabled
      ? ([
          {
            title: t('metrics.driver.returnWarning'),
            dataIndex: 'returnWarningCount',
            key: 'returnWarningCount',
            width: 110,
            defaultSortOrder: 'descend' as const,
            sorter: (a, b) => a.returnWarningCount - b.returnWarningCount,
            render: (v: number, row) => (
              <WarningCount count={v} waybillNos={row.returnWarningWaybillNos} title={t('waybillTitles.returnWarning')} />
            ),
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
    ...(enabled.has('driver.longTail')
      ? ([
          {
            title: t('metrics.driver.longTail'),
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
                <WaybillListPopover nos={row.longTailWaybillNos} title={t('waybillTitles.longTail')} placement="right">
                  {badge}
                </WaybillListPopover>
              )
            },
          },
        ] satisfies ColumnsType<DriverPerformanceRow>)
      : []),
  ]
}

type VendorCardProps = {
  row: VendorMetricRow
  fetchedData: FetchedData
  drivers: DriverPerformanceRow[]
  enabledMetricKeys: ReadonlySet<string>
  driverColumns: ColumnsType<DriverPerformanceRow>
  t: TFunction<'vendorAnalysis'>
  tc: TFunction<'common'>
}

function VendorCard({ row, fetchedData, drivers, enabledMetricKeys, driverColumns, t, tc }: VendorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [driversExpanded, setDriversExpanded] = useState(true)
  const fmt = (s: string) => s.slice(0, 10)

  const exitRate = row.before11ExitRate
  const exitColor =
    exitRate == null
      ? 'text-slate-300'
      : exitRate >= 0.99
        ? 'text-emerald-600'
        : exitRate >= 0.95
          ? 'text-amber-500'
          : 'text-red-600'

  const dispatchRateNum = row.dispatchRate24hText ? parseFloat(row.dispatchRate24hText) : null
  const dispatchTextColor =
    dispatchRateNum == null
      ? 'text-slate-300'
      : dispatchRateNum >= 95
        ? 'text-emerald-600'
        : dispatchRateNum >= 92
          ? 'text-amber-500'
          : 'text-red-600'

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

  const volumeSub = (current: number, total: number) =>
    `${t('countOfTotal', { count: current, total })} ${tc('pieces')}`

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 bg-[var(--admin-surface-soft)] px-5 py-2.5 text-left transition-colors hover:bg-slate-100"
      >
        <span className="text-sm font-semibold text-slate-800">{row.supplierNickname || row.vendorName}</span>
        <span className="text-xs text-slate-400">{row.vendorName} · {row.vendorCode}</span>
        {row.sharedVendorCode && (
          <Tooltip title={t('sharedCodeTooltip', { code: row.vendorCode })}>
            <span className="cursor-help rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
              {t('sharedCodeBadge')}
            </span>
          </Tooltip>
        )}
        <span className="ml-auto text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {t('dataOverview')}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <>
          {kpiCount > 0 && (
            <div
              className={`grid grid-cols-2 divide-x divide-y divide-[var(--admin-line)] border-b border-[var(--admin-line)] ${KPI_GRID_COLS[kpiCount]} sm:divide-y-0`}
            >
            {showBefore11 && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.before11UnmetWaybillNos} title={t('waybillTitles.before11Unmet')} placement="bottom">
                    <span className={`${exitColor}${row.before11UnmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                      {exitRate != null ? `${(exitRate * 100).toFixed(1)}%` : '—'}
                    </span>
                  </WaybillListPopover>
                }
                label={t('kpi.before11Label', { date: fmt(fetchedData.before11Date) })}
                sub={
                  row.before11ExitVolume != null && row.before11TotalReceived != null ? (
                    <span className="text-[11px] text-slate-400">
                      {volumeSub(row.before11ExitVolume, row.before11TotalReceived)}
                    </span>
                  ) : undefined
                }
              />
            )}

            {showDispatch24h && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.dispatch24hUnmetWaybillNos} title={t('waybillTitles.dispatch24hUnmet')} placement="bottom">
                    <span className={`${dispatchTextColor}${row.dispatch24hUnmetWaybillNos.length > 0 ? ' cursor-help' : ''}`}>
                      {row.dispatchRate24hText ?? '—'}
                    </span>
                  </WaybillListPopover>
                }
                label={t('kpi.dispatch24hLabel', { date: fetchedData.dayBeforeDate })}
                sub={
                  row.notMet24hSignCount != null && row.notMet24hSignCount > 0 ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      {t('kpi.unmetTickets', { count: row.notMet24hSignCount })}
                    </span>
                  ) : undefined
                }
              />
            )}

            {showComplaintRate && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.complaintOrderCodes} title={t('waybillTitles.complaint')} placement="bottom">
                    <span className={`${crColor}${row.complaintOrderCodes.length > 0 ? ' cursor-help' : ''}`}>
                      {(cr * 100).toFixed(3)}%
                    </span>
                  </WaybillListPopover>
                }
                label={t('kpi.complaintLabel', {
                  start: fmt(fetchedData.ticketStartTime),
                  end: fmt(fetchedData.ticketEndTime),
                })}
                sub={
                  row.complaintCount > 0 ? (
                    <span className="text-[11px] text-slate-400">
                      {t('kpi.complaintDetail', {
                        complaints: row.complaintCount,
                        pickups: row.waybillCount,
                      })}
                      {row.sharedVendorCode && (
                        <span className="text-amber-600">{t('kpi.complaintSharedNote')}</span>
                      )}
                    </span>
                  ) : undefined
                }
              />
            )}

            {showUnprocessed && (
              <KpiCard
                value={
                  <WaybillListPopover nos={row.unprocessedTicketOrderCodes} title={t('waybillTitles.unprocessedTicket')} placement="bottom">
                    <span className={`${row.unprocessedTicketCount > 0 ? 'text-red-600' : 'text-slate-400'}${row.unprocessedTicketOrderCodes.length > 0 ? ' cursor-help' : ''}`}>
                      {row.unprocessedTicketCount}
                    </span>
                  </WaybillListPopover>
                }
                label={t('kpi.unprocessedLabel')}
                sub={
                  row.unprocessedTicketCount > 0 ? (
                    <span className="text-[11px] font-semibold text-red-500">
                      {t('kpi.needsAction')}
                      {row.sharedVendorCode && (
                        <span className="font-normal text-amber-600">{t('kpi.sharedCodeNote')}</span>
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
                label={t('kpi.longTailLabel')}
              />
            )}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setDriversExpanded((v) => !v)}
              className="flex w-full flex-wrap items-center gap-2 border-b border-[var(--admin-line)] px-5 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('driverPerformance')}
              </span>

              <div className="ml-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  {t('allDriversSummary')}
                </span>
                {showReturnWarning && totalReturnWarning > 0 && (
                  <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    {t('returnWarningBadge', { count: totalReturnWarning })}
                  </span>
                )}
                {lowDispatchDrivers.length > 0 && (
                  <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                    {t('dispatchUnmetBadge', { count: lowDispatchDrivers.length })}
                  </span>
                )}
              </div>

              <span className="ml-auto text-xs text-slate-400">{t('driverCount', { count: drivers.length })}</span>
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
                      <div className="text-xs font-semibold text-amber-900">{t('performanceWarning')}</div>
                      <div className="mt-0.5 text-xs text-amber-800">
                        {t('performanceWarningBody', {
                          name: warningDriver.courierName || warningDriver.courierCode,
                          rate:
                            warningDriver.dispatchRate24h != null
                              ? `${(warningDriver.dispatchRate24h * 100).toFixed(1)}%`
                              : '—',
                          others:
                            lowDispatchDrivers.length > 1
                              ? t('andOthers', { count: lowDispatchDrivers.length })
                              : '',
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="px-5 py-4 [&_.ant-table-thead_th]:!py-2 [&_.ant-table-tbody_td]:!py-2.5 [&_.ant-table-thead_th]:!px-3 [&_.ant-table-tbody_td]:!px-3">
                  {drivers.length === 0 ? (
                    <p className="py-2 text-xs text-slate-400">{t('noDriverData')}</p>
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

export function VendorMetricsPreview({
  metrics,
  fetchedData,
  hasStations,
  driverPerformanceByVendor,
  enabledMetricKeys,
}: Props) {
  const { t } = useTranslation('vendorAnalysis')
  const { t: tc } = useTranslation('common')
  const driverColumns = useMemo(
    () => buildDriverColumns(enabledMetricKeys, t, tc),
    [enabledMetricKeys, t, tc],
  )

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex flex-wrap items-center gap-3 bg-[var(--admin-surface-soft)]">
        <div>
          <div className="admin-eyebrow">Preview</div>
          <h3 className="admin-title mt-0.5 flex items-center gap-1.5 text-base">
            <TrendingUp className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            {t('previewTitle')}
          </h3>
        </div>
        <div className="ml-auto text-xs text-slate-500">{t('previewHint')}</div>
      </div>

      {!hasStations && (
        <div className="border-b border-[var(--admin-line)] px-5 py-3">
          <Alert
            type="warning"
            showIcon
            message={t('noStationPreviewWarning')}
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
            t={t}
            tc={tc}
          />
        ))}
        {metrics.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-slate-400">{t('noVendorData')}</div>
        )}
      </div>
    </div>
  )
}
