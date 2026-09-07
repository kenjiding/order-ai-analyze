import { Empty, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('pushEngagement')

  const columns: ColumnsType<DateGroup> = useMemo(
    () => [
      {
        title: t('colDate'),
        dataIndex: 'date',
        width: 130,
        render: (date: string) => <span className="font-medium text-slate-800">{date}</span>,
      },
      {
        title: t('colMessageCount'),
        dataIndex: 'messageCount',
        width: 100,
      },
      {
        title: t('colPushTypes'),
        dataIndex: 'labels',
        render: (labels: string[]) => (
          <div className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <Tag key={label} color={PUSH_LABEL_COLOR[label] ?? 'default'}>
                {t(`pushLabels.${label}`, { defaultValue: label })}
              </Tag>
            ))}
          </div>
        ),
      },
      {
        title: t('colTotalClicks'),
        dataIndex: 'clicksByAction',
        width: 200,
        render: (clicks: Record<string, number>) => <ClicksCell clicks={clicks} />,
      },
    ],
    [t],
  )

  return (
    <Table<DateGroup>
      rowKey="date"
      columns={columns}
      dataSource={dateGroups}
      loading={loading}
      locale={{ emptyText: <Empty description={t('emptyRows')} /> }}
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
      pagination={{ pageSize: 20, showTotal: (total) => t('tableDaysTotal', { total }) }}
      scroll={{ x: 760 }}
    />
  )
}
