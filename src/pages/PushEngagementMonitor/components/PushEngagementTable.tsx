import { Empty, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { groupRowsByLabel, type DateGroup, type LabelGroup } from '../pushEngagementGrouping'
import { clickActionLabel, PUSH_LABEL_COLOR, type DetailState, type PushClickEvent, type PushReadStatus } from '../pushEngagementTypes'
import { PushLabelBreakdown } from './PushLabelBreakdown'

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
  dateGroups,
  loading,
  expandedDates,
  onExpandDate,
  expandedGroupKeys,
  readStatusByGroup,
  clickEventsByGroup,
  onExpandGroup,
  onRefreshGroup,
}: {
  dateGroups: DateGroup[]
  loading: boolean
  expandedDates: string[]
  onExpandDate: (expanded: boolean, date: string) => void
  expandedGroupKeys: string[]
  readStatusByGroup: Record<string, DetailState<PushReadStatus>>
  clickEventsByGroup: Record<string, DetailState<PushClickEvent[]>>
  onExpandGroup: (expanded: boolean, date: string, labelGroup: LabelGroup) => void
  onRefreshGroup: (date: string, labelGroup: LabelGroup) => void
}) {
  const columns: ColumnsType<DateGroup> = [
    {
      title: '日期',
      dataIndex: 'date',
      width: 130,
      render: (date: string) => <span className="font-medium text-slate-800">{date}</span>,
    },
    {
      title: '推送条数',
      dataIndex: 'messageCount',
      width: 100,
    },
    {
      title: '推送类型',
      dataIndex: 'labels',
      render: (labels: string[]) => (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <Tag key={label} color={PUSH_LABEL_COLOR[label] ?? 'default'}>
              {label}
            </Tag>
          ))}
        </div>
      ),
    },
    {
      title: '累计点击',
      dataIndex: 'clicksByAction',
      width: 200,
      render: (clicks: Record<string, number>) => <ClicksCell clicks={clicks} />,
    },
  ]

  return (
    <Table<DateGroup>
      rowKey="date"
      columns={columns}
      dataSource={dateGroups}
      loading={loading}
      locale={{ emptyText: <Empty description="所选条件下暂无推送记录" /> }}
      expandable={{
        expandedRowKeys: expandedDates,
        onExpand: (expanded, record) => onExpandDate(expanded, record.date),
        expandedRowRender: (group) => (
          <PushLabelBreakdown
            date={group.date}
            labelGroups={groupRowsByLabel(group.rows)}
            expandedGroupKeys={expandedGroupKeys}
            readStatusByGroup={readStatusByGroup}
            clickEventsByGroup={clickEventsByGroup}
            onExpandGroup={onExpandGroup}
            onRefreshGroup={onRefreshGroup}
          />
        ),
      }}
      pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 天` }}
      scroll={{ x: 760 }}
    />
  )
}
