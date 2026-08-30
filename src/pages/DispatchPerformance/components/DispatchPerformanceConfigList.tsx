import { Button, Empty, Popconfirm, Space, Switch, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BarChart3, Pencil, Trash2, Zap } from 'lucide-react'
import { QuadrantBar } from './QuadrantBar'
import type { DispatchPerformanceConfig } from '../dispatchPerformanceTypes'

/** 与详情页同一套阈值口径 */
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
}: {
  rate: number | null
  alertPct: number
  targetPct: number
  pending?: boolean
}) {
  if (pending) return <Tag className="m-0 text-xs">结算中</Tag>
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
  /** 正在跑「立刻统计」的配置 id；只让被点的那一行转圈 */
  settlingId: string | null
  onSettleNow: (config: DispatchPerformanceConfig) => void
}

/**
 * 配置列表同时是多站点看板：每行带该站点最近一批结算的两个率与达成分布，
 * 扫一眼就知道该点进哪个站点，再到详情页下钻到供应商 / 路由码 / 司机。
 */
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
}: Props) {
  const columns: ColumnsType<DispatchPerformanceConfig> = [
    {
      title: '站点',
      dataIndex: 'stationName',
      render: (name: string, row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{name || row.stationCode}</div>
          <div className="font-mono text-xs text-slate-400">{row.stationCode}</div>
        </div>
      ),
    },
    {
      title: '供应商',
      dataIndex: 'supplierCount',
      width: 110,
      align: 'right',
      // 0 家供应商时结算跑不出任何数据，必须提示，否则用户会以为任务没跑
      render: (count: number) =>
        count > 0 ? (
          <span className="tabular-nums">{count} 家</span>
        ) : (
          <Tooltip title="这条配置没有勾选任何供应商，结算跑不出数据。点「编辑」勾选该站点的实际承运商">
            <Tag color="warning" className="m-0">
              未选供应商
            </Tag>
          </Tooltip>
        ),
    },
    {
      title: '触发时间',
      dataIndex: 'settleTime',
      width: 100,
      align: 'center',
      // 按该站点所属州的本地时间跑，不是浏览器时间
      render: (time: string) => <span className="tabular-nums text-slate-600">{time}</span>,
    },
    {
      title: '最近结算',
      key: 'latestDate',
      width: 130,
      render: (_, row) =>
        row.latest ? (
          <span className="tabular-nums text-slate-600">{row.latest.arrivalDate}</span>
        ) : (
          <span className="text-xs text-slate-400">尚无数据</span>
        ),
    },
    {
      title: '11点前出仓率',
      key: 'before11Rate',
      width: 130,
      align: 'right',
      render: (_, row) => (
        <LatestRate
          rate={row.latest?.metrics.before11Rate ?? null}
          alertPct={BEFORE11_ALERT_PCT}
          targetPct={BEFORE11_TARGET_PCT}
        />
      ),
    },
    {
      title: '24H派签率',
      key: 'signRate',
      width: 130,
      align: 'right',
      // 读 latestDispatch 而不是 latest：派签比出仓晚一天结算，最新那天的派签必然还没算完，
      // 读 latest 会让这一列永远显示「结算中」。日期与出仓那列不同时标出来，避免看串。
      render: (_, row) => (
        <div className="flex flex-col items-end">
          <LatestRate
            rate={row.latestDispatch?.metrics.signRate ?? null}
            alertPct={SIGN_ALERT_PCT}
            targetPct={SIGN_TARGET_PCT}
            pending={row.latest != null && row.latestDispatch == null}
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
      title: '达成分布',
      key: 'quadrant',
      width: 180,
      // 四象限要出仓与派签都结算了才有意义，同样跟着 latestDispatch 走
      render: (_, row) =>
        row.latestDispatch ? (
          <QuadrantBar
            quadrant={row.latestDispatch.metrics.quadrant}
            total={row.latestDispatch.metrics.total}
          />
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      title: '启用',
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
      title: '操作',
      key: 'actions',
      width: 300,
      render: (_, row) => (
        <Space>
          <Tooltip
            title={
              row.supplierCount === 0
                ? '这条配置还没勾选供应商，点「编辑」先把该站点的承运商选上'
                : row.latest == null
                  ? '该站点还没有任何结算数据'
                  : ''
            }
          >
            <Button
              type="primary"
              icon={<BarChart3 className="h-4 w-4" />}
              onClick={() => onView(row)}
              disabled={row.latest == null}
            >
              查看明细
            </Button>
          </Tooltip>
          {/* 新站点到触发统计时间之前没有任何数据、进不去详情页，所以触发入口必须留在这一行 */}
          <Popconfirm
            title="立刻统计"
            description={
              <div className="max-w-[320px] text-xs leading-relaxed">
                出仓率与派签率都会立刻结算并写入历史。其中派签是<b>临时值</b>——24 小时窗口
                可能还没真正关闭，此刻定格会偏严；到了触发统计时间定时任务会重跑并覆盖成权威值。
              </div>
            }
            okText="开始统计"
            cancelText="取消"
            onConfirm={() => onSettleNow(row)}
          >
            <Tooltip title={row.isEnabled ? '不等触发统计时间，现在就结算这个站点' : '已停用的站点不结算'}>
              <Button
                icon={<Zap className="h-4 w-4" />}
                loading={settlingId === row.id}
                disabled={!row.isEnabled || (settlingId != null && settlingId !== row.id)}
              >
                立刻统计
              </Button>
            </Tooltip>
          </Popconfirm>
          <Tooltip title="编辑">
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(row)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button danger icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(row)} />
          </Tooltip>
        </Space>
      ),
    },
  ]

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
            description="还没有配置任何站点，点击右上角「添加统计站点」开始"
          />
        ),
      }}
    />
  )
}
