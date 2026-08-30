import { Table, Tag, Empty } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { QuadrantBar, QuadrantLegend } from './QuadrantBar'
import type {
  DispatchDriverNode,
  DispatchMetrics,
  DispatchRouteNode,
  DispatchSupplierNode,
} from '../dispatchPerformanceTypes'

/** 指标阈值沿用 metricsCatalog 的既有口径，两个指标各有各的线 */
const BEFORE11_ALERT_PCT = 95
const BEFORE11_TARGET_PCT = 99
const SIGN_ALERT_PCT = 92
const SIGN_TARGET_PCT = 95

function rateColor(rate: number | null, alertPct: number, targetPct: number): string {
  if (rate == null) return 'text-slate-300'
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
  alertPct: number
  targetPct: number
  /** rate 为 null 时的文案：区分「还没结算」和「这个范围本来就没单」 */
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

function GapCell({ gap }: { gap: number | null }) {
  if (gap == null) return <span className="text-slate-300">—</span>
  // 正差值 = 出仓率高于派签率，货交出去了却没派完，落差越大越指向司机侧
  const sign = gap > 0 ? '+' : ''
  return (
    <span className={`tabular-nums ${gap >= 10 ? 'font-semibold text-amber-600' : 'text-slate-600'}`}>
      {sign}
      {gap.toFixed(2)}
    </span>
  )
}

/** 三层表格共用的指标列，只有第一列（名称）随层级不同 */
function metricColumns<T extends DispatchMetrics>(): ColumnsType<T> {
  return [
    {
      title: '总单量',
      dataIndex: 'total',
      width: 90,
      align: 'right',
      render: (total: number) => <span className="tabular-nums">{total}</span>,
    },
    {
      title: '11点前出仓率',
      dataIndex: 'before11Rate',
      width: 130,
      align: 'right',
      render: (rate: number | null) => (
        <RateCell rate={rate} alertPct={BEFORE11_ALERT_PCT} targetPct={BEFORE11_TARGET_PCT} />
      ),
    },
    {
      title: '24H派签率',
      dataIndex: 'signRate',
      width: 120,
      align: 'right',
      // 派签比出仓晚一天结算，最新那天只有出仓率；显示「结算中」而不是把 null 画成 0%
      render: (rate: number | null, row) => (
        <RateCell
          rate={rate}
          alertPct={SIGN_ALERT_PCT}
          targetPct={SIGN_TARGET_PCT}
          pendingLabel={row.total > 0 && !row.dispatchSettled ? '结算中' : undefined}
        />
      ),
    },
    {
      title: '落差',
      dataIndex: 'rateGap',
      width: 90,
      align: 'right',
      render: (gap: number | null) => <GapCell gap={gap} />,
    },
    {
      title: '达成分布',
      key: 'quadrant',
      width: 200,
      render: (_, row) =>
        row.dispatchSettled ? (
          <QuadrantBar quadrant={row.quadrant} total={row.total} />
        ) : (
          <span className="text-xs text-slate-400">派签结算后可见</span>
        ),
    },
    {
      title: '问题件',
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

function WaybillList({ label, nos }: { label: string; nos: string[] }) {
  if (nos.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-500">
        {label}（{nos.length}）
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

function DriverDetail({ driver }: { driver: DispatchDriverNode }) {
  const hasAny =
    driver.neverSignedWaybillNos.length > 0 ||
    driver.lateSignedWaybillNos.length > 0 ||
    driver.problemWaybillNos.length > 0 ||
    driver.before11UnmetWaybillNos.length > 0
  if (!hasAny) {
    return <div className="px-4 py-2 text-xs text-slate-400">该司机本区间内全部达标</div>
  }
  return (
    <div className="space-y-3 px-4 py-3">
      <WaybillList label="从未签收" nos={driver.neverSignedWaybillNos} />
      <WaybillList label="超时签收" nos={driver.lateSignedWaybillNos} />
      <WaybillList label="问题件" nos={driver.problemWaybillNos} />
      <WaybillList label="未在11点前出仓" nos={driver.before11UnmetWaybillNos} />
    </div>
  )
}

function DriverTable({ drivers }: { drivers: DispatchDriverNode[] }) {
  const columns: ColumnsType<DispatchDriverNode> = [
    {
      title: '司机',
      dataIndex: 'courierName',
      render: (name: string, row) =>
        row.courierCode ? (
          <div className="min-w-0">
            <div className="truncate text-slate-800">{name}</div>
            <div className="font-mono text-xs text-slate-400">{row.courierCode}</div>
          </div>
        ) : (
          // 未派件的单没有司机可归，单独成行；它天然计入两个指标的未达标
          <span className="text-slate-500">未派件（无司机）</span>
        ),
    },
    ...metricColumns<DispatchDriverNode>(),
  ]

  return (
    <Table
      rowKey="courierCode"
      columns={columns}
      dataSource={drivers}
      pagination={false}
      expandable={{
        expandedRowRender: (driver) => <DriverDetail driver={driver} />,
        rowExpandable: (driver) =>
          driver.neverSignedWaybillNos.length > 0 ||
          driver.lateSignedWaybillNos.length > 0 ||
          driver.problemWaybillNos.length > 0 ||
          driver.before11UnmetWaybillNos.length > 0,
      }}
    />
  )
}

function RouteTable({ routes }: { routes: DispatchRouteNode[] }) {
  const columns: ColumnsType<DispatchRouteNode> = [
    {
      title: '路由码',
      dataIndex: 'routeCode',
      render: (routeCode: string) =>
        routeCode ? (
          <span className="font-mono text-slate-800">{routeCode}</span>
        ) : (
          <span className="text-slate-500">（无路由码）</span>
        ),
    },
    ...metricColumns<DispatchRouteNode>(),
  ]

  return (
    <Table
      rowKey="routeCode"
      columns={columns}
      dataSource={routes}
      pagination={false}
      expandable={{
        expandedRowRender: (route) => <DriverTable drivers={route.drivers} />,
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
  const columns: ColumnsType<DispatchSupplierNode> = [
    {
      title: '供应商',
      dataIndex: 'supplierName',
      render: (name: string, row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{name}</div>
          <div className="font-mono text-xs text-slate-400">{row.vendorCode}</div>
        </div>
      ),
    },
    ...metricColumns<DispatchSupplierNode>(),
  ]

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
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="该区间暂无已结算数据"
            />
          ),
        }}
        expandable={{
          expandedRowRender: (supplier) => <RouteTable routes={supplier.routes} />,
          rowExpandable: (supplier) => supplier.routes.length > 0,
        }}
      />
    </div>
  )
}
