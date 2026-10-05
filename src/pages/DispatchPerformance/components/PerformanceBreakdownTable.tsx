import { Table, Tag, Tooltip, Empty } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  DispatchDriverNode,
  DispatchMetrics,
  DispatchRouteNode,
  DispatchSupplierNode,
} from '../dispatchPerformanceTypes'
import {
  BEFORE11_ALERT_PCT,
  BEFORE11_TARGET_PCT,
  SIGN_ALERT_PCT,
  SIGN_TARGET_PCT,
  formatAvgTotal,
  rateColor,
} from '../dispatchMetricThresholds'

/** 查看异常报备回调的上下文：由表格逐层把 supplierKey / routeCode 带到司机行 */
type ExceptionRowContext = { supplierKey: string; routeCode: string; courierCode: string }

/** 表头文案超出列宽时省略号 + hover 显示全名，用于所有表头较长的列 */
function HeaderTitle({ text }: { text: string }) {
  return (
    <Tooltip title={text}>
      <span className="block truncate">{text}</span>
    </Tooltip>
  )
}

export function RateCell({
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

/** 「所属供应商X」徽标：这条路由是靠实际承运商兜底计入的，配置表里仍划给另一家 */
function ForeignVendorTag({
  vendorName,
  t,
}: {
  vendorName: string | undefined
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (!vendorName) return null
  return (
    <Tooltip title={t('breakdown.foreignVendorTooltip', { vendorName })}>
      <Tag color="orange" className="m-0 mt-0.5 text-xs">
        {t('breakdown.foreignVendorTag', { vendorName })}
      </Tag>
    </Tooltip>
  )
}

/**
 * 利润单元格。金额恒是数值，但有两种「这个数不是全部」的情况必须当场说清楚，
 * 否则一个偏小的金额看上去和正常值毫无区别：
 * - 区间里混了派签未结算的到件日 → 金额只是截至已结算日的累计；
 * - 有签收单没匹配到区域价格 → 那部分钱一分没算进来。
 */
export function ProfitCell({
  amount,
  unpriced,
  settled,
  t,
}: {
  amount: number
  unpriced: number
  settled: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="tabular-nums font-medium text-slate-800">${amount.toFixed(2)}</span>
      {!settled ? (
        <Tooltip title={t('breakdown.profitPartialTooltip')}>
          <span className="cursor-help text-xs text-slate-400">{t('breakdown.profitPartialTag')}</span>
        </Tooltip>
      ) : null}
      {unpriced > 0 ? (
        <Tooltip title={t('breakdown.unpricedTooltip', { count: unpriced })}>
          <span className="cursor-help text-xs tabular-nums text-amber-600">
            {t('breakdown.unpricedTag', { count: unpriced })}
          </span>
        </Tooltip>
      ) : null}
    </div>
  )
}

/**
 * 利润列。供应商行看供应商利润、司机行看司机利润、路由行夹在中间两个都给。
 * 单独一个工厂而不是塞进 metricColumns：那个是三层共用的，三层要的利润口径并不一样。
 */
function profitColumns<T extends DispatchMetrics>(
  t: (key: string, options?: Record<string, unknown>) => string,
  kinds: ('vendor' | 'courier')[],
): ColumnsType<T> {
  return kinds.map((kind) => ({
    title: (
      <HeaderTitle text={t(kind === 'vendor' ? 'breakdown.vendorProfit' : 'breakdown.courierProfit')} />
    ),
    key: `${kind}Profit`,
    width: 120,
    align: 'right' as const,
    render: (_: unknown, row: T) => (
      <ProfitCell
        amount={kind === 'vendor' ? row.vendorProfit : row.courierProfit}
        unpriced={row.unpricedSignedCount}
        settled={row.dispatchSettled}
        t={t}
      />
    ),
  }))
}

function metricColumns<T extends DispatchMetrics>(
  t: (key: string, options?: Record<string, unknown>) => string,
  dayCount: number,
): ColumnsType<T> {
  const settlingLabel = t('breakdown.settling')
  return [
    {
      title: <HeaderTitle text={t('breakdown.totalWaybills')} />,
      dataIndex: 'total',
      width: 110,
      align: 'right',
      render: (total: number) => (
        <span className="tabular-nums">{formatAvgTotal(total, dayCount)}</span>
      ),
    },
    {
      title: <HeaderTitle text={t('breakdown.before11HubExitRate')} />,
      dataIndex: 'before11Rate',
      width: 130,
      align: 'right',
      render: (rate: number | null) => (
        <RateCell rate={rate} alertPct={BEFORE11_ALERT_PCT} targetPct={BEFORE11_TARGET_PCT} />
      ),
    },
    {
      title: <HeaderTitle text={t('breakdown.sameDayExitRate')} />,
      dataIndex: 'sameDayExitRate',
      width: 140,
      align: 'right',
      render: (rate: number | null) => <RateCell rate={rate} />,
    },
    {
      title: <HeaderTitle text={t('breakdown.signRate24h')} />,
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
      title: <HeaderTitle text={t('breakdown.nextDaySignRate')} />,
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
      title: <HeaderTitle text={t('breakdown.priorityNextDaySignRate')} />,
      dataIndex: 'priorityNextDaySignRate',
      width: 160,
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
      title: <HeaderTitle text={t('breakdown.problemWaybills')} />,
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

/** 「已剔除 N 件」徽标：点开异常报备记录面板并预筛选到这一行 */
/**
 * 徽标本身只显示 24H 派签率的剔除数（count）——这是最常被关心的口径。
 * 但次日派签率 / 优先件次日完成率各自有独立算出来的剔除数，三者截止时间不同，
 * 同一批报备在三边生效的件数可能不一样（甚至某个口径是 0），必须在 tooltip 里
 * 把三个数都摆出来，不能让用户以为徽标上这一个数字就是全部指标共用的。
 */
function ExcludedTag({
  count,
  nextDayCount,
  priorityCount,
  onClick,
  t,
}: {
  count: number
  nextDayCount: number
  priorityCount: number
  onClick: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (count <= 0) return null
  return (
    <Tooltip
      title={t('exception.excludedBreakdownTooltip', {
        signCount: count,
        nextDayCount,
        priorityCount,
      })}
    >
      <Tag
        color="orange"
        className="m-0 mt-0.5 cursor-pointer text-xs"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        {t('exception.excludedTag', { count })}
      </Tag>
    </Tooltip>
  )
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
  supplierKey,
  routeCode,
  dayCount,
  t,
  onViewExceptions,
}: {
  drivers: DispatchDriverNode[]
  supplierKey: string
  routeCode: string
  dayCount: number
  t: (key: string, options?: Record<string, unknown>) => string
  onViewExceptions: (ctx: ExceptionRowContext) => void
}) {
  const columns: ColumnsType<DispatchDriverNode> = [
    {
      title: <HeaderTitle text={t('breakdown.driver')} />,
      dataIndex: 'courierName',
      width: 140,
      render: (name: string, row) =>
        row.courierCode ? (
          <div className="min-w-0 max-w-[140px]">
            <div className="truncate text-slate-800" title={name}>
              {name}
            </div>
            <div className="font-mono text-xs text-slate-400">{row.courierCode}</div>
            <ExcludedTag
              count={row.excludedCount}
              nextDayCount={row.excludedNextDayCount}
              priorityCount={row.excludedPriorityCount}
              onClick={() => onViewExceptions({ supplierKey, routeCode, courierCode: row.courierCode })}
              t={t}
            />
          </div>
        ) : (
          <span className="text-slate-500">{t('breakdown.unassignedDriver')}</span>
        ),
    },
    ...profitColumns<DispatchDriverNode>(t, ['courier']),
    ...metricColumns<DispatchDriverNode>(t, dayCount),
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
  supplierKey,
  dayCount,
  t,
  onViewExceptions,
}: {
  routes: DispatchRouteNode[]
  supplierKey: string
  dayCount: number
  t: (key: string, options?: Record<string, unknown>) => string
  onViewExceptions: (ctx: ExceptionRowContext) => void
}) {
  const columns: ColumnsType<DispatchRouteNode> = [
    {
      title: <HeaderTitle text={t('breakdown.routeCode')} />,
      dataIndex: 'routeCode',
      render: (routeCode: string, row) => (
        <div className="min-w-0">
          {routeCode ? (
            <span className="font-mono text-slate-800">{routeCode}</span>
          ) : (
            <span className="text-slate-500">{t('breakdown.noRouteCode')}</span>
          )}
          {row.whitelistTotal > 0 ? (
            <div className="mt-0.5">
              <WhitelistTag whitelistTotal={row.whitelistTotal} total={row.total} t={t} />
            </div>
          ) : null}
          <ForeignVendorTag vendorName={row.foreignVendorName} t={t} />
          <ExcludedTag
            count={row.excludedCount}
            nextDayCount={row.excludedNextDayCount}
            priorityCount={row.excludedPriorityCount}
            onClick={() => onViewExceptions({ supplierKey, routeCode, courierCode: '' })}
            t={t}
          />
        </div>
      ),
    },
    ...profitColumns<DispatchRouteNode>(t, ['vendor', 'courier']),
    ...metricColumns<DispatchRouteNode>(t, dayCount),
  ]

  return (
    <Table
      rowKey="routeCode"
      columns={columns}
      dataSource={routes}
      pagination={false}
      expandable={{
        expandedRowRender: (route) => (
          <DriverTable
            drivers={route.drivers}
            supplierKey={supplierKey}
            routeCode={route.routeCode}
            dayCount={dayCount}
            t={t}
            onViewExceptions={onViewExceptions}
          />
        ),
        rowExpandable: (route) => route.drivers.length > 0,
      }}
    />
  )
}

export function PerformanceBreakdownTable({
  suppliers,
  loading,
  dayCount,
  onViewExceptions,
}: {
  suppliers: DispatchSupplierNode[]
  loading: boolean
  /** 区间内有数据的到件日天数，用来把「总单量」拆成「平均/总」两个数 */
  dayCount: number
  onViewExceptions: (ctx: ExceptionRowContext) => void
}) {
  const { t } = useTranslation('dispatchPerformance')

  const columns: ColumnsType<DispatchSupplierNode> = useMemo(
    () => [
      {
        title: <HeaderTitle text={t('breakdown.vendor')} />,
        dataIndex: 'supplierName',
        width: 110,
        render: (name: string, row) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{name}</div>
            <div className="font-mono text-xs text-slate-400">{row.vendorCode}</div>
          </div>
        ),
      },
      ...profitColumns<DispatchSupplierNode>((key, options) => t(key, options), ['vendor']),
      ...metricColumns<DispatchSupplierNode>((key, options) => t(key, options), dayCount),
    ],
    [t, dayCount],
  )

  return (
    <div className="space-y-3">
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
            <RouteTable
              routes={supplier.routes}
              supplierKey={supplier.supplierKey}
              dayCount={dayCount}
              t={(key, options) => t(key, options)}
              onViewExceptions={onViewExceptions}
            />
          ),
          rowExpandable: (supplier) => supplier.routes.length > 0,
        }}
      />
    </div>
  )
}
