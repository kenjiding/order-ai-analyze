import { Button, Dropdown, Empty, Popconfirm, Space, Switch, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BarChart3, MoreHorizontal, Pencil, Trash2, Upload, Zap } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { DispatchPerformanceConfig } from '../dispatchPerformanceTypes'

const BEFORE11_ALERT_PCT = 95
const BEFORE11_TARGET_PCT = 99
const SIGN_ALERT_PCT = 92
const SIGN_TARGET_PCT = 95

function rateClass(rate: number, alertPct: number, targetPct: number): string {
  if (rate < alertPct) return 'text-red-600'
  if (rate < targetPct) return 'text-amber-600'
  return 'text-emerald-600'
}

function LatestRate({
  rate,
  alertPct,
  targetPct,
  pending,
  settlingLabel,
}: {
  rate: number | null
  alertPct: number
  targetPct: number
  pending?: boolean
  settlingLabel: string
}) {
  if (pending) return <Tag className="m-0 text-xs">{settlingLabel}</Tag>
  if (rate == null) return <span className="text-slate-300">—</span>
  return (
    <span className={`tabular-nums font-semibold ${rateClass(rate, alertPct, targetPct)}`}>
      {rate.toFixed(2)}%
    </span>
  )
}

type Props = {
  configs: DispatchPerformanceConfig[]
  loading: boolean
  togglingIds: string[]
  onView: (config: DispatchPerformanceConfig) => void
  onEdit: (config: DispatchPerformanceConfig) => void
  onDelete: (config: DispatchPerformanceConfig) => void
  onToggleEnabled: (config: DispatchPerformanceConfig, enabled: boolean) => void
  settlingId: string | null
  onSettleNow: (config: DispatchPerformanceConfig) => void
  onUploadSettle: (config: DispatchPerformanceConfig) => void
}

export function DispatchPerformanceConfigList({
  configs,
  loading,
  togglingIds,
  onView,
  onEdit,
  onDelete,
  onToggleEnabled,
  settlingId,
  onSettleNow,
  onUploadSettle,
}: Props) {
  const { t } = useTranslation(['dispatchPerformance', 'common'])

  const columns: ColumnsType<DispatchPerformanceConfig> = useMemo(
    () => [
      {
        title: t('list.station', { ns: 'dispatchPerformance' }),
        dataIndex: 'stationName',
        render: (name: string, row) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{name || row.stationCode}</div>
            <div className="font-mono text-xs text-slate-400">{row.stationCode}</div>
          </div>
        ),
      },
      {
        title: t('list.vendor', { ns: 'dispatchPerformance' }),
        dataIndex: 'supplierCount',
        width: 110,
        align: 'right',
        render: (count: number) =>
          count > 0 ? (
            <span className="tabular-nums">
              {t('list.vendorCount', { ns: 'dispatchPerformance', count })}
            </span>
          ) : (
            <Tooltip title={t('list.noVendorTooltip', { ns: 'dispatchPerformance' })}>
              <Tag color="warning" className="m-0">
                {t('list.noVendorSelected', { ns: 'dispatchPerformance' })}
              </Tag>
            </Tooltip>
          ),
      },
      {
        title: t('list.triggerTime', { ns: 'dispatchPerformance' }),
        dataIndex: 'settleTime',
        width: 100,
        align: 'center',
        render: (time: string) => <span className="tabular-nums text-slate-600">{time}</span>,
      },
      {
        title: t('list.latestSettle', { ns: 'dispatchPerformance' }),
        key: 'latestDate',
        width: 130,
        render: (_, row) =>
          row.latest ? (
            <span className="tabular-nums text-slate-600">{row.latest.arrivalDate}</span>
          ) : (
            <span className="text-xs text-slate-400">
              {t('list.noDataYet', { ns: 'dispatchPerformance' })}
            </span>
          ),
      },
      {
        title: t('list.before11HubExitRate', { ns: 'dispatchPerformance' }),
        key: 'before11Rate',
        width: 130,
        align: 'right',
        render: (_, row) => (
          <LatestRate
            rate={row.latest?.metrics.before11Rate ?? null}
            alertPct={BEFORE11_ALERT_PCT}
            targetPct={BEFORE11_TARGET_PCT}
            settlingLabel={t('list.settling', { ns: 'dispatchPerformance' })}
          />
        ),
      },
      {
        title: t('list.signRate24h', { ns: 'dispatchPerformance' }),
        key: 'signRate',
        width: 130,
        align: 'right',
        render: (_, row) => (
          <div className="flex flex-col items-end">
            <LatestRate
              rate={row.latestDispatch?.metrics.signRate ?? null}
              alertPct={SIGN_ALERT_PCT}
              targetPct={SIGN_TARGET_PCT}
              pending={row.latest != null && row.latestDispatch == null}
              settlingLabel={t('list.settling', { ns: 'dispatchPerformance' })}
            />
            {row.latestDispatch && row.latestDispatch.arrivalDate !== row.latest?.arrivalDate ? (
              <span className="font-mono text-[11px] text-slate-400">
                {row.latestDispatch.arrivalDate}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        title: t('list.priorityNextDaySignRate', { ns: 'dispatchPerformance' }),
        key: 'priorityRate',
        width: 140,
        align: 'right',
        render: (_, row) =>
          row.latestDispatch && row.latestDispatch.metrics.priorityTotal > 0 ? (
            <LatestRate
              rate={row.latestDispatch.metrics.priorityNextDaySignRate}
              alertPct={SIGN_ALERT_PCT}
              targetPct={SIGN_TARGET_PCT}
              settlingLabel={t('list.settling', { ns: 'dispatchPerformance' })}
            />
          ) : (
            <span className="text-xs text-slate-400">—</span>
          ),
      },
      {
        title: t('list.enabled', { ns: 'dispatchPerformance' }),
        dataIndex: 'isEnabled',
        width: 80,
        render: (enabled: boolean, row) => (
          <Switch
            checked={enabled}
            loading={togglingIds.includes(row.id)}
            onChange={(next) => onToggleEnabled(row, next)}
          />
        ),
      },
      {
        title: t('list.actions', { ns: 'dispatchPerformance' }),
        key: 'actions',
        width: 150,
        render: (_, row) => (
          <Space>
            <Tooltip
              title={
                row.supplierCount === 0
                  ? t('list.viewDetailNoVendor', { ns: 'dispatchPerformance' })
                  : row.latest == null
                    ? t('list.viewDetailNoData', { ns: 'dispatchPerformance' })
                    : ''
              }
            >
              <Button
                type="primary"
                icon={<BarChart3 className="h-4 w-4" />}
                onClick={() => onView(row)}
                disabled={row.latest == null}
              >
                {t('list.viewDetail', { ns: 'dispatchPerformance' })}
              </Button>
            </Tooltip>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              popupRender={() => (
                <div className="flex w-48 flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <Popconfirm
                    title={t('list.settleNowConfirmTitle', { ns: 'dispatchPerformance' })}
                    description={
                      <div className="max-w-[320px] text-xs leading-relaxed">
                        {t('list.settleNowConfirmDescPrefix', { ns: 'dispatchPerformance' })}
                        <b>{t('list.settleNowConfirmDescBold', { ns: 'dispatchPerformance' })}</b>
                        {t('list.settleNowConfirmDescSuffix', { ns: 'dispatchPerformance' })}
                      </div>
                    }
                    okText={t('list.startSettle', { ns: 'dispatchPerformance' })}
                    cancelText={t('cancel', { ns: 'common' })}
                    onConfirm={() => onSettleNow(row)}
                  >
                    <Tooltip
                      placement="left"
                      title={
                        row.isEnabled
                          ? t('list.settleNowTooltip', { ns: 'dispatchPerformance' })
                          : t('list.settleNowDisabledTooltip', { ns: 'dispatchPerformance' })
                      }
                    >
                      <Button
                        type="text"
                        block
                        className="!justify-start"
                        icon={<Zap className="h-4 w-4" />}
                        loading={settlingId === row.id}
                        disabled={!row.isEnabled || (settlingId != null && settlingId !== row.id)}
                      >
                        {t('list.settleNow', { ns: 'dispatchPerformance' })}
                      </Button>
                    </Tooltip>
                  </Popconfirm>
                  <Tooltip placement="left" title={t('list.uploadSettleTooltip', { ns: 'dispatchPerformance' })}>
                    <Button
                      type="text"
                      block
                      className="!justify-start"
                      icon={<Upload className="h-4 w-4" />}
                      onClick={() => onUploadSettle(row)}
                      disabled={!row.isEnabled || settlingId != null}
                    >
                      {t('list.uploadSettle', { ns: 'dispatchPerformance' })}
                    </Button>
                  </Tooltip>
                  <Button
                    type="text"
                    block
                    className="!justify-start"
                    icon={<Pencil className="h-4 w-4" />}
                    onClick={() => onEdit(row)}
                  >
                    {t('edit', { ns: 'common' })}
                  </Button>
                  <Button
                    type="text"
                    danger
                    block
                    className="!justify-start"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => onDelete(row)}
                  >
                    {t('delete', { ns: 'common' })}
                  </Button>
                </div>
              )}
            >
              <Button icon={<MoreHorizontal className="h-4 w-4" />} />
            </Dropdown>
          </Space>
        ),
      },
    ],
    [
      onDelete,
      onEdit,
      onSettleNow,
      onToggleEnabled,
      onUploadSettle,
      onView,
      settlingId,
      t,
      togglingIds,
    ],
  )

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={configs}
      loading={loading}
      pagination={false}
      scroll={{ x: 1180 }}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('list.empty', { ns: 'dispatchPerformance' })}
          />
        ),
      }}
    />
  )
}
