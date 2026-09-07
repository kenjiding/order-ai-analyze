import { Button, InputNumber, Popover, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AlertTriangle, Settings, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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

const STATUS_COLORS: Record<RouteCodeStatus, { color: string; tint: string }> = {
  ok: { color: 'success', tint: '#16a34a' },
  warning: { color: 'warning', tint: '#d97706' },
  bad: { color: 'error', tint: '#dc2626' },
  insufficient: { color: 'default', tint: '#94a3b8' },
}

const STATUS_LABEL_KEY: Record<RouteCodeStatus, 'route.statusOk' | 'route.statusWarning' | 'route.statusBad' | 'route.statusInsufficient'> = {
  ok: 'route.statusOk',
  warning: 'route.statusWarning',
  bad: 'route.statusBad',
  insufficient: 'route.statusInsufficient',
}

function StatusTag({ status }: { status: RouteCodeStatus }) {
  const { t } = useTranslation('newMerchant')
  const meta = STATUS_COLORS[status]
  return <Tag color={meta.color}>{t(STATUS_LABEL_KEY[status])}</Tag>
}

function ThresholdsPopoverContent({
  thresholds,
  onChange,
}: {
  thresholds: RouteCodeThresholds
  onChange: (next: RouteCodeThresholds) => void
}) {
  const { t } = useTranslation('newMerchant')
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
        label={t('route.thresholdMinVolume')}
        value={thresholds.minVolume}
        suffix={t('route.suffixParcels')}
        min={1}
        max={9999}
        step={1}
        onCommit={(v) => onChange({ ...thresholds, minVolume: v })}
      />
      <Row
        label={t('route.thresholdMinSignRate')}
        value={Math.round(thresholds.minSignRate * 100)}
        suffix="%"
        min={0}
        max={100}
        step={1}
        onCommit={(v) => onChange({ ...thresholds, minSignRate: v / 100 })}
      />
      <Row
        label={t('route.thresholdMinWithin24h')}
        value={Math.round(thresholds.minWithin24hRate * 100)}
        suffix="%"
        min={0}
        max={100}
        step={1}
        onCommit={(v) => onChange({ ...thresholds, minWithin24hRate: v / 100 })}
      />
      <Row
        label={t('route.thresholdMaxTransit')}
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
        {t('route.resetDefaults')}
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

const VOLUME_WAYBILL_PREVIEW_LIMIT = 80

function formatEmptyDriverLabel(value: string, unassigned = '未分配'): string {
  return value === '(空)' ? unassigned : value
}

function WaybillNosHoverPopover({
  label,
  waybillNos,
  listTitle,
  labelClassName,
  moreHiddenText,
}: {
  label: ReactNode
  waybillNos: string[]
  listTitle: string
  labelClassName?: string
  moreHiddenText?: (count: number) => string
}) {
  const preview = waybillNos.slice(0, VOLUME_WAYBILL_PREVIEW_LIMIT)
  const hiddenCount = waybillNos.length - preview.length

  if (!waybillNos.length) {
    return <span className={labelClassName}>{label}</span>
  }

  return (
    <Popover
      trigger="hover"
      placement="left"
      content={
        <div className="max-h-56 w-56 overflow-auto py-1">
          <div className="mb-1 px-2 text-xs text-slate-500">
            {listTitle}（{waybillNos.length}）
          </div>
          <ul className="list-none space-y-0.5 px-2 text-xs text-slate-700">
            {preview.map((no) => (
              <li key={no} className="font-mono">
                {no}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <div className="px-2 pt-1 text-xs text-slate-400">
              {moreHiddenText ? moreHiddenText(hiddenCount) : `+${hiddenCount}`}
            </div>
          ) : null}
        </div>
      }
    >
      <span
        className={`cursor-default border-b border-dashed border-slate-300 ${labelClassName ?? ''}`}
      >
        {label}
      </span>
    </Popover>
  )
}

function VolumeWaybillPopover({
  volume,
  waybillNos,
  listTitle,
  moreHiddenText,
}: {
  volume: number
  waybillNos: string[]
  listTitle: string
  moreHiddenText: (count: number) => string
}) {
  return (
    <WaybillNosHoverPopover
      label={formatCount(volume)}
      waybillNos={waybillNos}
      listTitle={listTitle}
      moreHiddenText={moreHiddenText}
    />
  )
}

function buildBreakdownColumns(
  t: TFunction<'newMerchant'>,
  unassigned: string,
): ColumnsType<CourierBreakdownRow> {
  const moreHidden = (count: number) => t('route.moreWaybillsHidden', { count })
  return [
    {
      title: t('route.colCourierVendor'),
      dataIndex: 'vendor',
      key: 'vendor',
      width: 160,
      ellipsis: true,
      render: (v: string) => formatEmptyDriverLabel(v, unassigned),
    },
    {
      title: t('route.colCourier'),
      key: 'courier',
      width: 200,
      render: (_, r) => (
        <div className="flex flex-col">
          <span className="text-sm">{formatEmptyDriverLabel(r.courier, unassigned)}</span>
          <span className="text-[11px] text-slate-400">
            {r.courierCode === '-' ? '' : r.courierCode}
          </span>
        </div>
      ),
    },
    {
      title: t('route.colVolume'),
      dataIndex: 'volume',
      key: 'volume',
      width: 80,
      align: 'right',
      render: (v: number, r) => (
        <VolumeWaybillPopover
          volume={v}
          waybillNos={r.waybillNos}
          listTitle={t('route.waybillNo')}
          moreHiddenText={moreHidden}
        />
      ),
      sorter: (a, b) => a.volume - b.volume,
    },
    {
      title: t('route.colSignRate'),
      dataIndex: 'signRate',
      key: 'signRate',
      width: 100,
      align: 'right',
      render: (v: number | null, r) => (
        <WaybillNosHoverPopover
          label={formatPercent(v)}
          waybillNos={r.notSignedWaybillNos}
          listTitle={t('route.unsignedWaybills')}
          labelClassName={r.volume < 5 ? 'text-slate-400' : 'text-slate-800'}
          moreHiddenText={moreHidden}
        />
      ),
      sorter: (a, b) => (a.signRate ?? -1) - (b.signRate ?? -1),
    },
    {
      title: t('route.colWithin24h'),
      dataIndex: 'within24hRate',
      key: 'within24hRate',
      width: 110,
      align: 'right',
      render: (v: number | null, r) => (
        <WaybillNosHoverPopover
          label={formatPercent(v)}
          waybillNos={r.notWithin24hWaybillNos}
          listTitle={t('route.notWithin24hWaybills')}
          labelClassName={r.dispatchedCount < 5 ? 'text-slate-400' : 'text-slate-800'}
          moreHiddenText={moreHidden}
        />
      ),
      sorter: (a, b) => (a.within24hRate ?? -1) - (b.within24hRate ?? -1),
    },
    {
      title: t('route.colMedianTransit'),
      dataIndex: 'medianTransitDays',
      key: 'medianTransitDays',
      width: 110,
      align: 'right',
      render: (v: number | null) => formatDays(v),
      sorter: (a, b) => (a.medianTransitDays ?? 999) - (b.medianTransitDays ?? 999),
    },
  ]
}

function CourierExpandPanel({
  records,
  routeCode,
}: {
  records: WaybillRecord[]
  routeCode: string
}) {
  const { t } = useTranslation('newMerchant')
  const unassigned = t('route.unassigned')
  const rows = useMemo(() => computeCourierBreakdown(records, routeCode), [records, routeCode])
  const breakdownColumns = useMemo(
    () => buildBreakdownColumns(t, unassigned),
    [t, unassigned],
  )
  if (!rows.length) {
    return (
      <div className="py-3 text-center text-xs text-slate-400">{t('route.noCourierBreakdown')}</div>
    )
  }
  return (
    <div className="bg-slate-50/60 p-2">
      <Table<CourierBreakdownRow>
        columns={breakdownColumns}
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
  const { t } = useTranslation('newMerchant')
  const statusMeta = useMemo(
    () =>
      ({
        ok: { ...STATUS_COLORS.ok, label: t('route.statusOk') },
        warning: { ...STATUS_COLORS.warning, label: t('route.statusWarning') },
        bad: { ...STATUS_COLORS.bad, label: t('route.statusBad') },
        insufficient: { ...STATUS_COLORS.insufficient, label: t('route.statusInsufficient') },
      }) satisfies Record<RouteCodeStatus, { label: string; color: string; tint: string }>,
    [t],
  )
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
        title: t('route.colRouteCode'),
        dataIndex: 'routeCode',
        key: 'routeCode',
        width: 130,
        render: (v: string) => <span className="font-medium text-slate-900">{v}</span>,
      },
      {
        title: t('route.colStatus'),
        dataIndex: 'status',
        key: 'status',
        width: 100,
        filters: [
          { text: t('route.statusBad'), value: 'bad' },
          { text: t('route.statusWarning'), value: 'warning' },
          { text: t('route.statusOk'), value: 'ok' },
          { text: t('route.statusInsufficient'), value: 'insufficient' },
        ],
        onFilter: (value, r) => r.status === value,
        render: (s: RouteCodeStatus) => <StatusTag status={s} />,
      },
      {
        title: t('route.colVolume'),
        dataIndex: 'volume',
        key: 'volume',
        width: 90,
        align: 'right',
        render: (v: number) => formatCount(v),
        sorter: (a, b) => a.volume - b.volume,
      },
      {
        title: t('route.colSignRate'),
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
        title: t('route.colWithin24h'),
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
        title: t('route.colMedianTransit'),
        dataIndex: 'medianTransitDays',
        key: 'medianTransitDays',
        width: 110,
        align: 'right',
        render: (v: number | null) => formatDays(v),
        sorter: (a, b) => (a.medianTransitDays ?? 999) - (b.medianTransitDays ?? 999),
      },
      {
        title: t('route.colMedianSign'),
        dataIndex: 'medianSignDays',
        key: 'medianSignDays',
        width: 110,
        align: 'right',
        render: (v: number | null) => formatDays(v),
        sorter: (a, b) => (a.medianSignDays ?? 999) - (b.medianSignDays ?? 999),
      },
      {
        title: t('route.colViolationItems'),
        dataIndex: 'violations',
        key: 'violations',
        render: (v: string[]) =>
          v.length ? (
            <span className="text-xs text-red-600">{v.join('；')}</span>
          ) : (
            <span className="text-xs text-slate-400">{t('route.none')}</span>
          ),
      },
    ],
    [t],
  )

  const topBadColumns: ColumnsType<RouteCodeRow> = useMemo(
    () => [
      { title: t('route.colRouteCode'), dataIndex: 'routeCode', key: 'routeCode', width: 130, render: (v: string) => <span className="font-semibold text-slate-900">{v}</span> },
      { title: t('route.colVolume'), dataIndex: 'volume', key: 'volume', width: 90, align: 'right', render: (v: number) => formatCount(v) },
      { title: t('route.colSignRate'), dataIndex: 'signRate', key: 'signRate', width: 100, align: 'right', render: (v: number | null) => <span className="font-semibold text-red-600">{formatPercent(v)}</span> },
      { title: t('route.colWithin24h'), dataIndex: 'within24hRate', key: 'within24hRate', width: 130, align: 'right', render: (v: number | null) => <span className="font-semibold text-red-600">{formatPercent(v)}</span> },
      { title: t('route.colMedianTransit'), dataIndex: 'medianTransitDays', key: 'medianTransitDays', width: 110, align: 'right', render: (v: number | null) => <span className="font-semibold text-red-600">{formatDays(v)}</span> },
      { title: t('route.colTopVendor'), dataIndex: 'topVendor', key: 'topVendor', width: 160, ellipsis: true, render: (v: string | null) => v ?? '--' },
      { title: t('route.colViolations'), dataIndex: 'violations', key: 'violations', render: (v: string[]) => (v.length ? <span className="text-xs text-red-600">{v.join('；')}</span> : '--') },
    ],
    [t],
  )

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-700">{t('route.title')}</div>
          <div className="text-xs text-slate-500">{t('route.subtitle')}</div>
        </div>
        <Popover
          trigger="click"
          placement="bottomRight"
          content={
            <ThresholdsPopoverContent thresholds={thresholds} onChange={onThresholdsChange} />
          }
        >
          <Button icon={<Settings className="h-4 w-4" aria-hidden />}>{t('route.thresholdAdjust')}</Button>
        </Popover>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <CounterPill
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          label={statusMeta.bad.label}
          value={summary.bad}
          tint={statusMeta.bad.tint}
        />
        <CounterPill
          icon={<TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
          label={statusMeta.warning.label}
          value={summary.warning}
          tint={statusMeta.warning.tint}
        />
        <CounterPill
          icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
          label={statusMeta.ok.label}
          value={summary.ok}
          tint={statusMeta.ok.tint}
        />
        <CounterPill
          icon={<span className="h-2 w-2 rounded-full bg-slate-300" />}
          label={statusMeta.insufficient.label}
          value={summary.insufficient}
          tint={statusMeta.insufficient.tint}
        />
      </div>

      {topBad.length ? (
        <div className="mb-4 rounded-xl border border-red-100 bg-red-50/40 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            <span>{t('route.badTopN', { count: topBad.length })}</span>
          </div>
          <Table<RouteCodeRow>
            columns={topBadColumns}
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
