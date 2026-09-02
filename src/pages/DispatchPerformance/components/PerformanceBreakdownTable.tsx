import { Table, Tag, Tooltip, Empty } from 'antd'
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

/**
 * 白名单标记：该路由在供应商配置的路由码白名单里，不参与考核。
 * 区间内改过配置时只有部分天数不计入，此时必须说清是「部分」，
 * 否则用户会以为整条路由都没算进供应商的率。
 */
function WhitelistTag({ whitelistTotal, total }: { whitelistTotal: number; total: number }) {
  if (whitelistTotal <= 0) return null
  const partial = whitelistTotal < total
  return (
    <Tooltip
      title={
        partial
          ? `本区间内该路由有 ${whitelistTotal} / ${total} 单落在白名单上（中途改过白名单配置）：这部分没有计入上面供应商行与站点汇总的两个率，其余照常计入。`
          : '该路由在供应商配置的路由码白名单里：本行指标照常统计，但不计入上面供应商行与站点汇总的两个率。'
      }
    >
      <Tag color="default" className="m-0 text-xs">
        {partial ? `白名单 · ${whitelistTotal} 单不计入` : '白名单 · 不计入'}
      </Tag>
    </Tooltip>
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

/** count 是权威数量；nos 被服务端按司机封顶截断过（见 MAX_WAYBILL_NOS_PER_DRIVER） */
function WaybillList({ label, nos, count }: { label: string; nos: string[]; count: number }) {
  if (nos.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-500">
        {label}（{count}）
        {nos.length < count ? (
          <span className="ml-1 font-normal text-slate-400">仅显示前 {nos.length} 条</span>
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
      <WaybillList
        label="从未签收"
        nos={driver.neverSignedWaybillNos}
        count={driver.neverSignedCount}
      />
      <WaybillList
        label="超时签收"
        nos={driver.lateSignedWaybillNos}
        count={driver.lateSignedCount}
      />
      <WaybillList label="问题件" nos={driver.problemWaybillNos} count={driver.problemCount} />
      <WaybillList
        label="未在11点前出仓"
        nos={driver.before11UnmetWaybillNos}
        count={driver.total - driver.before11Met}
      />
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
      render: (routeCode: string, row) => (
        <div className="flex items-center gap-2">
          {routeCode ? (
            <span className="font-mono text-slate-800">{routeCode}</span>
          ) : (
            <span className="text-slate-500">（无路由码）</span>
          )}
          <WhitelistTag whitelistTotal={row.whitelistTotal} total={row.total} />
        </div>
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
          {/* 展开后各路由之和会大于本行 total，这里把差额说清楚，免得被当成算错 */}
          {row.whitelistTotal > 0 ? (
            <div className="mt-0.5 text-xs text-slate-400">
              另有 {row.whitelistTotal} 单白名单路由，未计入本行
            </div>
          ) : null}
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
