import { Table, Tag, Tooltip, Empty } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { QuadrantBar, QuadrantLegend } from './QuadrantBar'
import type {
  DispatchDriverNode,
  DispatchMetrics,
  DispatchRouteNode,
  DispatchSupplierNode,
} from '../dispatchPerformanceTypes'

const BEFORE11_ALERT_PCT = 95
const BEFORE11_TARGET_PCT = 99
const SIGN_ALERT_PCT = 92
const SIGN_TARGET_PCT = 95

function rateColor(rate: number | null, alertPct?: number, targetPct?: number): string {
  if (rate == null) return 'text-slate-300'
  // 没有考核目标的指标（当天出仓率）不着色
  if (alertPct == null || targetPct == null) return 'text-slate-700'
  if (rate < alertPct) return 'text-red-600'
  if (rate < targetPct) return 'text-amber-600'
  return 'text-emerald-600'
}

function RateCell({
  rate,
  alertPct,
  targetPct,
  pendingLabel,
}: {
  rate: number | null
  alertPct?: number
  targetPct?: number
  pendingLabel?: string
}) {
  if (rate == null) {
    return pendingLabel ? (
      <Tag className="m-0 text-xs">{pendingLabel}</Tag>
    ) : (
      <span className="text-slate-300">—</span>
    )
  }
  return (
    <span className={`tabular-nums font-medium ${rateColor(rate, alertPct, targetPct)}`}>
      {rate.toFixed(2)}%
    </span>
  )
}

function WhitelistTag({
  whitelistTotal,
  total,
  t,
}: {
  whitelistTotal: number
  total: number
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (whitelistTotal <= 0) return null
  const partial = whitelistTotal < total
  return (
    <Tooltip
      title={
        partial
          ? t('breakdown.whitelistPartialTooltip', { whitelistTotal, total })
          : t('breakdown.whitelistFullTooltip')
      }
    >
      <Tag color="default" className="m-0 text-xs">
        {partial
          ? t('breakdown.whitelistPartialTag', { count: whitelistTotal })
          : t('breakdown.whitelistFullTag')}
      </Tag>
    </Tooltip>
  )
}

function GapCell({ gap }: { gap: number | null }) {
  if (gap == null) return <span className="text-slate-300">—</span>
  const sign = gap > 0 ? '+' : ''
  return (
    <span className={`tabular-nums ${gap >= 10 ? 'font-semibold text-amber-600' : 'text-slate-600'}`}>
      {sign}
      {gap.toFixed(2)}
    </span>
  )
}

function metricColumns<T extends DispatchMetrics>(
  t: (key: string, options?: Record<string, unknown>) => string,
): ColumnsType<T> {
  const settlingLabel = t('breakdown.settling')
  return [
    {
      title: t('breakdown.totalWaybills'),
      dataIndex: 'total',
      width: 90,
      align: 'right',
      render: (total: number) => <span className="tabular-nums">{total}</span>,
    },
    {
      title: t('breakdown.before11HubExitRate'),
      dataIndex: 'before11Rate',
      width: 130,
      align: 'right',
      render: (rate: number | null) => (
        <RateCell rate={rate} alertPct={BEFORE11_ALERT_PCT} targetPct={BEFORE11_TARGET_PCT} />
      ),
    },
    {
      title: t('breakdown.sameDayExitRate'),
      dataIndex: 'sameDayExitRate',
      width: 110,
      align: 'right',
      render: (rate: number | null) => <RateCell rate={rate} />,
    },
    {
      title: t('breakdown.signRate24h'),
      dataIndex: 'signRate',
      width: 120,
      align: 'right',
      render: (rate: number | null, row) => (
        <RateCell
          rate={rate}
          alertPct={SIGN_ALERT_PCT}
          targetPct={SIGN_TARGET_PCT}
          pendingLabel={row.total > 0 && !row.dispatchSettled ? settlingLabel : undefined}
        />
      ),
    },
    {
      title: t('breakdown.nextDaySignRate'),
      dataIndex: 'nextDaySignRate',
      width: 110,
      align: 'right',
      render: (rate: number | null, row) => (
        <RateCell
          rate={rate}
          alertPct={SIGN_ALERT_PCT}
          targetPct={SIGN_TARGET_PCT}
          pendingLabel={row.total > 0 && !row.dispatchSettled ? settlingLabel : undefined}
        />
      ),
    },
    {
      title: t('breakdown.priorityNextDaySignRate'),
      dataIndex: 'priorityNextDaySignRate',
      width: 130,
      align: 'right',
      render: (rate: number | null, row) => (
        <div className="flex flex-col items-end">
          <RateCell
            rate={rate}
            alertPct={SIGN_ALERT_PCT}
            targetPct={SIGN_TARGET_PCT}
            pendingLabel={row.priorityTotal > 0 && !row.dispatchSettled ? settlingLabel : undefined}
          />
          {row.priorityTotal > 0 && row.dispatchSettled && (
            <span className="text-xs tabular-nums text-slate-400">
              {row.priorityNextDaySignMet} / {row.priorityTotal}
            </span>
          )}
        </div>
      ),
    },
    {
      title: t('breakdown.rateGap'),
      dataIndex: 'rateGap',
      width: 90,
      align: 'right',
      render: (gap: number | null) => <GapCell gap={gap} />,
    },
    {
      title: t('breakdown.quadrantDistribution'),
      key: 'quadrant',
      width: 200,
      render: (_, row) =>
        row.dispatchSettled ? (
          <QuadrantBar quadrant={row.quadrant} total={row.total} />
        ) : (
          <span className="text-xs text-slate-400">{t('breakdown.quadrantPending')}</span>
        ),
    },
    {
      title: t('breakdown.problemWaybills'),
      dataIndex: 'problemCount',
      width: 90,
      align: 'right',
      render: (count: number, row) =>
        !row.dispatchSettled ? (
          <span className="text-slate-300">—</span>
        ) : count > 0 ? (
          <span className="tabular-nums text-amber-600">{count}</span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
  ]
}

function WaybillList({
  label,
  nos,
  count,
  t,
}: {
  label: string
  nos: string[]
  count: number
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (nos.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-500">
        {label}（{count}）
        {nos.length < count ? (
          <span className="ml-1 font-normal text-slate-400">
            {t('breakdown.waybillListTruncated', { shown: nos.length })}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {nos.map((no) => (
          <Tag key={no} className="m-0 font-mono text-xs">
            {no}
          </Tag>
        ))}
      </div>
    </div>
  )
}

function DriverDetail({
  driver,
  t,
}: {
  driver: DispatchDriverNode
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const hasAny =
    driver.neverSignedWaybillNos.length > 0 ||
    driver.lateSignedWaybillNos.length > 0 ||
    driver.problemWaybillNos.length > 0 ||
    driver.before11UnmetWaybillNos.length > 0
  if (!hasAny) {
    return (
      <div className="px-4 py-2 text-xs text-slate-400">{t('breakdown.driverAllMet')}</div>
    )
  }
  return (
    <div className="space-y-3 px-4 py-3">
      <WaybillList
        label={t('breakdown.neverSigned')}
        nos={driver.neverSignedWaybillNos}
        count={driver.neverSignedCount}
        t={t}
      />
      <WaybillList
        label={t('breakdown.lateSigned')}
        nos={driver.lateSignedWaybillNos}
        count={driver.lateSignedCount}
        t={t}
      />
      <WaybillList
        label={t('breakdown.problemWaybill')}
        nos={driver.problemWaybillNos}
        count={driver.problemCount}
        t={t}
      />
      <WaybillList
        label={t('breakdown.before11Unmet')}
        nos={driver.before11UnmetWaybillNos}
        count={driver.total - driver.before11Met}
        t={t}
      />
    </div>
  )
}

function DriverTable({
  drivers,
  t,
}: {
  drivers: DispatchDriverNode[]
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const columns: ColumnsType<DispatchDriverNode> = [
    {
      title: t('breakdown.driver'),
      dataIndex: 'courierName',
      render: (name: string, row) =>
        row.courierCode ? (
          <div className="min-w-0">
            <div className="truncate text-slate-800">{name}</div>
            <div className="font-mono text-xs text-slate-400">{row.courierCode}</div>
          </div>
        ) : (
          <span className="text-slate-500">{t('breakdown.unassignedDriver')}</span>
        ),
    },
    ...metricColumns<DispatchDriverNode>(t),
  ]

  return (
    <Table
      rowKey="courierCode"
      columns={columns}
      dataSource={drivers}
      pagination={false}
      expandable={{
        expandedRowRender: (driver) => <DriverDetail driver={driver} t={t} />,
        rowExpandable: (driver) =>
          driver.neverSignedWaybillNos.length > 0 ||
          driver.lateSignedWaybillNos.length > 0 ||
          driver.problemWaybillNos.length > 0 ||
          driver.before11UnmetWaybillNos.length > 0,
      }}
    />
  )
}

function RouteTable({
  routes,
  t,
}: {
  routes: DispatchRouteNode[]
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const columns: ColumnsType<DispatchRouteNode> = [
    {
      title: t('breakdown.routeCode'),
      dataIndex: 'routeCode',
      render: (routeCode: string, row) => (
        <div className="flex items-center gap-2">
          {routeCode ? (
            <span className="font-mono text-slate-800">{routeCode}</span>
          ) : (
            <span className="text-slate-500">{t('breakdown.noRouteCode')}</span>
          )}
          <WhitelistTag whitelistTotal={row.whitelistTotal} total={row.total} t={t} />
        </div>
      ),
    },
    ...metricColumns<DispatchRouteNode>(t),
  ]

  return (
    <Table
      rowKey="routeCode"
      columns={columns}
      dataSource={routes}
      pagination={false}
      expandable={{
        expandedRowRender: (route) => <DriverTable drivers={route.drivers} t={t} />,
        rowExpandable: (route) => route.drivers.length > 0,
      }}
    />
  )
}

export function PerformanceBreakdownTable({
  suppliers,
  loading,
}: {
  suppliers: DispatchSupplierNode[]
  loading: boolean
}) {
  const { t } = useTranslation('dispatchPerformance')

  const columns: ColumnsType<DispatchSupplierNode> = useMemo(
    () => [
      {
        title: t('breakdown.vendor'),
        dataIndex: 'supplierName',
        render: (name: string, row) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{name}</div>
            <div className="font-mono text-xs text-slate-400">{row.vendorCode}</div>
            {row.whitelistTotal > 0 ? (
              <div className="mt-0.5 text-xs text-slate-400">
                {t('breakdown.whitelistExtra', { count: row.whitelistTotal })}
              </div>
            ) : null}
          </div>
        ),
      },
      ...metricColumns<DispatchSupplierNode>((key, options) => t(key, options)),
    ],
    [t],
  )

  return (
    <div className="space-y-3">
      <QuadrantLegend />
      <Table
        rowKey="supplierKey"
        columns={columns}
        dataSource={suppliers}
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('breakdown.empty')} />
          ),
        }}
        expandable={{
          expandedRowRender: (supplier) => (
            <RouteTable routes={supplier.routes} t={(key, options) => t(key, options)} />
          ),
          rowExpandable: (supplier) => supplier.routes.length > 0,
        }}
      />
    </div>
  )
}
