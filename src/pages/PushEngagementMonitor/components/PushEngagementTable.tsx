import { Empty, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { AU_REGIONS } from '../../ExitAlarm/exitAlarmTypes'
import { clickActionLabel, type PushClickEvent, type PushEngagementRow, type PushReadStatus } from '../pushEngagementTypes'
import { ExpandedRowContent } from './ExpandedRowContent'

type DetailState<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

const PUSH_LABEL_COLOR: Record<string, string> = {
  '11点出仓告警': 'orange',
  '24H派签告警': 'blue',
  催派推送: 'volcano',
  工单推送: 'purple',
}

function regionLabel(code: string): string {
  if (!code) return '—'
  if (code === 'global') return '全部州'
  return AU_REGIONS.find((r) => r.code === code)?.name ?? code
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ClicksCell({ clicks }: { clicks: Record<string, number> }) {
  const entries = Object.entries(clicks).filter(([, n]) => n > 0)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) return <span className="text-sm text-slate-400">0</span>
  return (
    <div>
      <span className="font-semibold text-[#1f6f68]">{total}</span>
      <div className="mt-0.5 text-xs text-slate-400">
        {entries.map(([action, n]) => `${clickActionLabel(action)} ${n}`).join(' · ')}
      </div>
    </div>
  )
}

export function PushEngagementTable({
  rows,
  loading,
  expandedRowKeys,
  onExpandRow,
  readStatusById,
  clickEventsById,
}: {
  rows: PushEngagementRow[]
  loading: boolean
  expandedRowKeys: string[]
  onExpandRow: (expanded: boolean, row: PushEngagementRow) => void
  readStatusById: Record<string, DetailState<PushReadStatus>>
  clickEventsById: Record<string, DetailState<PushClickEvent[]>>
}) {
  const columns: ColumnsType<PushEngagementRow> = [
    {
      title: '州/区域',
      dataIndex: 'regionCode',
      width: 110,
      render: (code: string) => <Tag>{regionLabel(code)}</Tag>,
    },
    {
      title: '供应商',
      dataIndex: 'vendorName',
      render: (name: string) => <span className="font-medium text-slate-800">{name || '—'}</span>,
    },
    {
      title: '推送类型',
      dataIndex: 'pushLabel',
      width: 130,
      render: (label: string | null) =>
        label ? <Tag color={PUSH_LABEL_COLOR[label] ?? 'default'}>{label}</Tag> : <span className="text-slate-400">—</span>,
    },
    {
      title: '推送时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (iso: string) => <span className="text-sm text-slate-600">{formatDateTime(iso)}</span>,
    },
    {
      title: '点击',
      dataIndex: 'clicks',
      width: 160,
      render: (clicks: Record<string, number>) => <ClicksCell clicks={clicks} />,
    },
  ]

  return (
    <Table<PushEngagementRow>
      rowKey="id"
      columns={columns}
      dataSource={rows}
      loading={loading}
      locale={{ emptyText: <Empty description="所选条件下暂无推送记录" /> }}
      expandable={{
        expandedRowKeys,
        onExpand: onExpandRow,
        expandedRowRender: (row) => (
          <ExpandedRowContent row={row} readStatus={readStatusById[row.id]} clickEvents={clickEventsById[row.id]} />
        ),
      }}
      pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
      scroll={{ x: 760 }}
    />
  )
}
