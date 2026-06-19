import { Button, InputNumber, Popover, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AlertTriangle, Settings, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import {
  computeCourierBreakdown,
  DEFAULT_ROUTE_CODE_THRESHOLDS,
  formatCount,
  formatDays,
  formatPercent,
  type CourierBreakdownRow,
  type RouteCodeRow,
  type RouteCodeStatus,
  type RouteCodeThresholds,
  type WaybillRecord,
} from '../metrics'

type Props = {
  records: WaybillRecord[]
  routeCodeRows: RouteCodeRow[]
  thresholds: RouteCodeThresholds
  onThresholdsChange: (next: RouteCodeThresholds) => void
}

const STATUS_META: Record<RouteCodeStatus, { label: string; color: string; tint: string }> = {
  ok: { label: '达标', color: 'success', tint: '#16a34a' },
  warning: { label: '警告', color: 'warning', tint: '#d97706' },
  bad: { label: '不达标', color: 'error', tint: '#dc2626' },
  insufficient: { label: '样本不足', color: 'default', tint: '#94a3b8' },
}

function StatusTag({ status }: { status: RouteCodeStatus }) {
  const meta = STATUS_META[status]
  return <Tag color={meta.color}>{meta.label}</Tag>
}

function ThresholdsPopoverContent({
  thresholds,
  onChange,
}: {
  thresholds: RouteCodeThresholds
  onChange: (next: RouteCodeThresholds) => void
}) {
  const Row = ({
    label,
    value,
    suffix,
    onCommit,
    min,
    max,
    step,
  }: {
    label: string
    value: number
    suffix: string
    onCommit: (v: number) => void
    min: number
    max: number
    step: number
  }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-600">{label}</span>
      <InputNumber
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(v) => {
          if (typeof v === 'number' && Number.isFinite(v)) onCommit(v)
        }}
        addonAfter={suffix}
        style={{ width: 140 }}
      />
    </div>
  )

  return (
    <div className="flex w-72 flex-col gap-3">
      <Row
        label="货量门槛"
        value={thresholds.minVolume}
        suffix="单"
        min={1}
        max={9999}
        step={1}
        onCommit={(v) => onChange({ ...thresholds, minVolume: v })}
      />
      <Row
        label="签收率 ≥"
        value={Math.round(thresholds.minSignRate * 100)}
        suffix="%"
        min={0}
        max={100}
        step={1}
        onCommit={(v) => onChange({ ...thresholds, minSignRate: v / 100 })}
      />
      <Row
        label="24h派签率 ≥"
        value={Math.round(thresholds.minWithin24hRate * 100)}
        suffix="%"
        min={0}
        max={100}
        step={1}
        onCommit={(v) => onChange({ ...thresholds, minWithin24hRate: v / 100 })}
      />
      <Row
        label="中位转运 ≤"
        value={thresholds.maxMedianTransitDays}
        suffix="D"
        min={0.5}
        max={30}
        step={0.5}
        onCommit={(v) => onChange({ ...thresholds, maxMedianTransitDays: v })}
      />
      <Button
        type="link"
        onClick={() => onChange(DEFAULT_ROUTE_CODE_THRESHOLDS)}
        className="self-end p-0"
      >
        恢复默认
      </Button>
    </div>
  )
}

function CounterPill({
  icon,
  label,
  value,
  tint,
}: {
  icon: ReactNode
  label: string
  value: number
  tint: string
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5"
      style={{ color: tint }}
    >
      {icon}
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: tint }}>
        {value}
      </span>
    </div>
  )
}

const TOP_BAD_COLUMNS: ColumnsType<RouteCodeRow> = [
  {
    title: '路由码',
    dataIndex: 'routeCode',
    key: 'routeCode',
    width: 130,
    render: (v: string) => <span className="font-semibold text-slate-900">{v}</span>,
  },
  {
    title: '货量',
    dataIndex: 'volume',
    key: 'volume',
    width: 90,
    align: 'right',
    render: (v: number) => formatCount(v),
  },
  {
    title: '签收率',
    dataIndex: 'signRate',
    key: 'signRate',
    width: 100,
    align: 'right',
    render: (v: number | null) => <span className="font-semibold text-red-600">{formatPercent(v)}</span>,
  },
  {
    title: '24h派签率',
    dataIndex: 'within24hRate',
    key: 'within24hRate',
    width: 130,
    align: 'right',
    render: (v: number | null) => <span className="font-semibold text-red-600">{formatPercent(v)}</span>,
  },
  {
    title: '中位转运',
    dataIndex: 'medianTransitDays',
    key: 'medianTransitDays',
    width: 110,
    align: 'right',
    render: (v: number | null) => <span className="font-semibold text-red-600">{formatDays(v)}</span>,
  },
  {
    title: '主要派件供应商',
    dataIndex: 'topVendor',
    key: 'topVendor',
    width: 160,
    ellipsis: true,
    render: (v: string | null) => v ?? '--',
  },
  {
    title: '主要违反项',
    dataIndex: 'violations',
    key: 'violations',
    render: (v: string[]) =>
      v.length ? <span className="text-xs text-red-600">{v.join('；')}</span> : '--',
  },
]

const VOLUME_WAYBILL_PREVIEW_LIMIT = 80

function formatEmptyDriverLabel(value: string): string {
  return value === '(空)' ? '未分配' : value
}

function VolumeWaybillPopover({ volume, waybillNos }: { volume: number; waybillNos: string[] }) {
  const preview = waybillNos.slice(0, VOLUME_WAYBILL_PREVIEW_LIMIT)
  const hiddenCount = waybillNos.length - preview.length
  const label = formatCount(volume)

  if (!waybillNos.length) {
    return <span>{label}</span>
  }

  return (
    <Popover
      trigger="hover"
      placement="left"
      content={
        <div className="max-h-56 w-56 overflow-auto py-1">
          <div className="mb-1 px-2 text-xs text-slate-500">运单号（{waybillNos.length}）</div>
          <ul className="list-none space-y-0.5 px-2 text-xs text-slate-700">
            {preview.map((no) => (
              <li key={no} className="font-mono">
                {no}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <div className="px-2 pt-1 text-xs text-slate-400">另有 {hiddenCount} 单未展示</div>
          ) : null}
        </div>
      }
    >
      <span className="cursor-default border-b border-dashed border-slate-300">{label}</span>
    </Popover>
  )
}

const BREAKDOWN_COLUMNS: ColumnsType<CourierBreakdownRow> = [
  {
    title: '派件供应商',
    dataIndex: 'vendor',
    key: 'vendor',
    width: 160,
    ellipsis: true,
    render: (v: string) => formatEmptyDriverLabel(v),
  },
  {
    title: '派件司机',
    key: 'courier',
    width: 200,
    render: (_, r) => (
      <div className="flex flex-col">
        <span className="text-sm">{formatEmptyDriverLabel(r.courier)}</span>
        <span className="text-[11px] text-slate-400">
          {r.courierCode === '-' ? '' : r.courierCode}
        </span>
      </div>
    ),
  },
  {
    title: '货量',
    dataIndex: 'volume',
    key: 'volume',
    width: 80,
    align: 'right',
    render: (v: number, r) => <VolumeWaybillPopover volume={v} waybillNos={r.waybillNos} />,
    sorter: (a, b) => a.volume - b.volume,
  },
  {
    title: '签收率',
    dataIndex: 'signRate',
    key: 'signRate',
    width: 100,
    align: 'right',
    render: (v: number | null, r) => (
      <span className={r.volume < 5 ? 'text-slate-400' : 'text-slate-800'}>{formatPercent(v)}</span>
    ),
    sorter: (a, b) => (a.signRate ?? -1) - (b.signRate ?? -1),
  },
  {
    title: '中位转运',
    dataIndex: 'medianTransitDays',
    key: 'medianTransitDays',
    width: 110,
    align: 'right',
    render: (v: number | null) => formatDays(v),
    sorter: (a, b) => (a.medianTransitDays ?? 999) - (b.medianTransitDays ?? 999),
  },
]

function CourierExpandPanel({
  records,
  routeCode,
}: {
  records: WaybillRecord[]
  routeCode: string
}) {
  const rows = useMemo(() => computeCourierBreakdown(records, routeCode), [records, routeCode])
  if (!rows.length) {
    return <div className="py-3 text-center text-xs text-slate-400">该路由码下无派件司机记录</div>
  }
  return (
    <div className="bg-slate-50/60 p-2">
      <Table<CourierBreakdownRow>
        columns={BREAKDOWN_COLUMNS}
        dataSource={rows}
        rowKey="key"
        pagination={false}
        bordered={false}
      />
    </div>
  )
}

export default function RouteCodePerformanceSection({
  records,
  routeCodeRows,
  thresholds,
  onThresholdsChange,
}: Props) {
  const summary = useMemo(() => {
    const counts: Record<RouteCodeStatus, number> = {
      ok: 0,
      warning: 0,
      bad: 0,
      insufficient: 0,
    }
    for (const r of routeCodeRows) counts[r.status] += 1
    return counts
  }, [routeCodeRows])

  const topBad = useMemo(
    () => routeCodeRows.filter((r) => r.status === 'bad').slice(0, 5),
    [routeCodeRows],
  )

  const columns: ColumnsType<RouteCodeRow> = useMemo(
    () => [
      {
        title: '路由码',
        dataIndex: 'routeCode',
        key: 'routeCode',
        width: 130,
        render: (v: string) => <span className="font-medium text-slate-900">{v}</span>,
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        filters: [
          { text: '不达标', value: 'bad' },
          { text: '警告', value: 'warning' },
          { text: '达标', value: 'ok' },
          { text: '样本不足', value: 'insufficient' },
        ],
        onFilter: (value, r) => r.status === value,
        render: (s: RouteCodeStatus) => <StatusTag status={s} />,
      },
      {
        title: '货量',
        dataIndex: 'volume',
        key: 'volume',
        width: 90,
        align: 'right',
        render: (v: number) => formatCount(v),
        sorter: (a, b) => a.volume - b.volume,
      },
      {
        title: '签收率',
        dataIndex: 'signRate',
        key: 'signRate',
        width: 110,
        align: 'right',
        render: (v: number | null, r) => (
          <Tooltip title={`${formatCount(r.signedCount)} / ${formatCount(r.volume)}`}>
            <span>{formatPercent(v)}</span>
          </Tooltip>
        ),
        sorter: (a, b) => (a.signRate ?? -1) - (b.signRate ?? -1),
      },
      {
        title: '24h派签率',
        dataIndex: 'within24hRate',
        key: 'within24hRate',
        width: 130,
        align: 'right',
        render: (v: number | null, r) => (
          <Tooltip title={`${formatCount(r.within24hCount)} / ${formatCount(r.volume)}`}>
            <span>{formatPercent(v)}</span>
          </Tooltip>
        ),
        sorter: (a, b) => (a.within24hRate ?? -1) - (b.within24hRate ?? -1),
      },
      {
        title: '中位转运',
        dataIndex: 'medianTransitDays',
        key: 'medianTransitDays',
        width: 110,
        align: 'right',
        render: (v: number | null) => formatDays(v),
        sorter: (a, b) => (a.medianTransitDays ?? 999) - (b.medianTransitDays ?? 999),
      },
      {
        title: '中位签收',
        dataIndex: 'medianSignDays',
        key: 'medianSignDays',
        width: 110,
        align: 'right',
        render: (v: number | null) => formatDays(v),
        sorter: (a, b) => (a.medianSignDays ?? 999) - (b.medianSignDays ?? 999),
      },
      {
        title: '违反项',
        dataIndex: 'violations',
        key: 'violations',
        render: (v: string[]) =>
          v.length ? (
            <span className="text-xs text-red-600">{v.join('；')}</span>
          ) : (
            <span className="text-xs text-slate-400">无</span>
          ),
      },
    ],
    [],
  )

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-700">路由码达标分析</div>
          <div className="text-xs text-slate-500">
            按 consigneeRouteCode 分组，违反阈值 ≥2 项判定为不达标；点击行展开派件供应商/派件司机明细。
          </div>
        </div>
        <Popover
          trigger="click"
          placement="bottomRight"
          content={
            <ThresholdsPopoverContent thresholds={thresholds} onChange={onThresholdsChange} />
          }
        >
          <Button icon={<Settings className="h-4 w-4" aria-hidden />}>阈值调节</Button>
        </Popover>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <CounterPill
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          label="不达标"
          value={summary.bad}
          tint={STATUS_META.bad.tint}
        />
        <CounterPill
          icon={<TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
          label="警告"
          value={summary.warning}
          tint={STATUS_META.warning.tint}
        />
        <CounterPill
          icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
          label="达标"
          value={summary.ok}
          tint={STATUS_META.ok.tint}
        />
        <CounterPill
          icon={<span className="h-2 w-2 rounded-full bg-slate-300" />}
          label="样本不足"
          value={summary.insufficient}
          tint={STATUS_META.insufficient.tint}
        />
      </div>

      {topBad.length ? (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span>不达标 Top {topBad.length}</span>
          </div>
          <Table<RouteCodeRow>
            columns={TOP_BAD_COLUMNS}
            dataSource={topBad}
            rowKey="routeCode"
            pagination={false}
            scroll={{ x: 920 }}
          />
        </div>
      ) : null}

      <Table<RouteCodeRow>
        columns={columns}
        dataSource={routeCodeRows}
        rowKey="routeCode"
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1180 }}
        expandable={{
          expandedRowRender: (row) => (
            <CourierExpandPanel records={records} routeCode={row.routeCode} />
          ),
          rowExpandable: (row) => row.volume > 0,
        }}
      />
    </div>
  )
}
