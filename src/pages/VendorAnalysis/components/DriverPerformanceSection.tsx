import { useState } from 'react'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ChevronDown, Users } from 'lucide-react'
import type { DriverPerformanceRow, VendorPushConfig } from '../vendorAnalysisTypes'

type Props = {
  configs: VendorPushConfig[]
  driverPerformanceByVendor: Record<string, DriverPerformanceRow[]>
}

function PickupChip({ count }: { count: number }) {
  if (count === 0) return <span className="text-slate-400 text-sm">0</span>
  return (
    <span className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-blue-50 px-3 py-0.5 text-sm font-semibold text-blue-600">
      {count}
    </span>
  )
}

function DispatchRateBadge({
  rate,
  count,
  total,
}: {
  rate: number | null
  count: number
  total: number
}) {
  if (rate == null) return <span className="text-sm text-slate-400">—</span>
  const pct = (rate * 100).toFixed(1)
  const colorCls =
    rate >= 0.92
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : rate >= 0.75
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-red-50 border-red-200 text-red-700'
  return (
    <div>
      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-bold ${colorCls}`}>
        {pct}%
      </span>
      {total > 0 && (
        <div className="mt-0.5 text-[11px] text-slate-400">
          {count}/{total} 件
        </div>
      )}
    </div>
  )
}

function WarningCount({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold text-emerald-600">
        0
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-[2.25rem] items-center justify-center rounded-full bg-red-50 px-2.5 py-0.5 text-sm font-semibold text-red-600">
      {count}
    </span>
  )
}

const columns: ColumnsType<DriverPerformanceRow> = [
  {
    title: '司机',
    key: 'courier',
    width: 150,
    render: (_, row) => (
      <div>
        <div className="font-medium text-slate-800">{row.courierName || '—'}</div>
        <div className="text-xs text-slate-400">{row.courierCode}</div>
      </div>
    ),
  },
  {
    title: '路由码',
    dataIndex: 'routeCode',
    key: 'routeCode',
    width: 130,
    render: (v: string) => <span className="text-xs text-slate-500">{v || '—'}</span>,
  },
  {
    title: '今日取件',
    dataIndex: 'ofdCount',
    key: 'ofdCount',
    width: 110,
    sorter: (a, b) => a.ofdCount - b.ofdCount,
    render: (v: number) => <PickupChip count={v} />,
  },
  {
    title: '24H派签率',
    key: 'dispatchRate24h',
    width: 140,
    sorter: (a, b) => (a.dispatchRate24h ?? -1) - (b.dispatchRate24h ?? -1),
    render: (_, row) => (
      <DispatchRateBadge
        rate={row.dispatchRate24h}
        count={row.dispatch24hCount}
        total={row.totalDispatchCount}
      />
    ),
  },
  {
    title: '归班预警',
    dataIndex: 'returnWarningCount',
    key: 'returnWarningCount',
    width: 110,
    defaultSortOrder: 'descend',
    sorter: (a, b) => a.returnWarningCount - b.returnWarningCount,
    render: (v: number) => <WarningCount count={v} />,
  },
]

type VendorBlockProps = {
  config: VendorPushConfig
  drivers: DriverPerformanceRow[]
}

function SummaryChip({
  children,
  variant,
}: {
  children: React.ReactNode
  variant: 'amber' | 'red' | 'orange' | 'slate'
}) {
  const cls = {
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    slate: 'bg-slate-100 border-slate-200 text-slate-500',
  }[variant]
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  )
}

function VendorBlock({ config, drivers }: VendorBlockProps) {
  const [expanded, setExpanded] = useState(true)

  const totalReturnWarning = drivers.reduce((s, d) => s + d.returnWarningCount, 0)
  const lowDispatchDrivers = drivers.filter(
    (d) => d.dispatchRate24h != null && d.dispatchRate24h < 0.92,
  )

  // 找出派签率最低且低于达标线的司机，用于预警 banner
  const warningDriver =
    lowDispatchDrivers.length > 0
      ? [...lowDispatchDrivers].sort((a, b) => (a.dispatchRate24h ?? 1) - (b.dispatchRate24h ?? 1))[0]
      : null

  return (
    <div className="divide-y divide-[var(--admin-line)]">
      {/* 供应商标题行 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-800">{config.vendorName}</span>
        <span className="text-xs text-slate-400">{config.vendorCode}</span>
        {config.isDisabled && (
          <span className="text-xs text-slate-400">（推送已禁用）</span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <SummaryChip variant="amber">⚠ 全员汇总</SummaryChip>
          {totalReturnWarning > 0 && (
            <SummaryChip variant="red">归班预警 {totalReturnWarning}</SummaryChip>
          )}
          {lowDispatchDrivers.length > 0 && (
            <SummaryChip variant="orange">派签未达标 {lowDispatchDrivers.length} 人</SummaryChip>
          )}
          <span className="text-xs text-slate-400">{drivers.length} 位派件员</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {expanded && (
        <div>
          {/* 预警 banner */}
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
              <p className="py-2 text-xs text-slate-400">暂无数据</p>
            ) : (
              <Table<DriverPerformanceRow>
                rowKey="courierCode"
                columns={columns}
                dataSource={drivers}
                pagination={false}
                scroll={{ x: 680 }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function DriverPerformanceSection({ configs, driverPerformanceByVendor }: Props) {
  if (configs.length === 0) return null

  const allDrivers = configs.flatMap((c) => driverPerformanceByVendor[c.vendorCode] ?? [])
  const totalReturnWarning = allDrivers.reduce((s, d) => s + d.returnWarningCount, 0)
  const lowDispatchCount = allDrivers.filter(
    (d) => d.dispatchRate24h != null && d.dispatchRate24h < 0.92,
  ).length

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex flex-wrap items-center gap-3 bg-[var(--admin-surface-soft)]">
        <div>
          <div className="admin-eyebrow">Driver Performance</div>
          <h3 className="admin-title mt-0.5 flex items-center gap-1.5 text-base">
            <Users className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            司机派件表现
          </h3>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {totalReturnWarning > 0 && (
            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              归班预警 {totalReturnWarning}
            </span>
          )}
          {lowDispatchCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
              派签未达标 {lowDispatchCount} 人
            </span>
          )}
          <span className="text-xs text-slate-500">
            取件量（昨日）· 24H派签率（前日）· 归班预警（当日14:00起超48h）
          </span>
        </div>
      </div>

      <div className="divide-y divide-[var(--admin-line)]">
        {configs.map((config) => (
          <VendorBlock
            key={config.vendorCode}
            config={config}
            drivers={driverPerformanceByVendor[config.vendorCode] ?? []}
          />
        ))}
      </div>
    </div>
  )
}
