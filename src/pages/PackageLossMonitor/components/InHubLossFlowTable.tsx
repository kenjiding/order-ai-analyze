import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { FlowTableDimKey, InHubLossFlowTableRow, SankeyColumn } from '../inHubLossAnalytics'

type Props = {
  columns: SankeyColumn[]
  rows: InHubLossFlowTableRow[]
}

export function InHubLossFlowTable({ columns, rows }: Props) {
  const { t } = useTranslation('packageLoss')

  const tableColumns: ColumnsType<InHubLossFlowTableRow> = useMemo(
    () => [
      ...columns.map((column) => ({
        title: column.title,
        dataIndex: column.key,
        key: column.key,
        ellipsis: true,
        onCell: (row: InHubLossFlowTableRow) => ({
          rowSpan: row.spans[column.key as FlowTableDimKey] ?? 1,
        }),
      })),
      {
        title: t('analytics.count'),
        dataIndex: 'count',
        key: 'count',
        align: 'right' as const,
        width: 88,
      },
      {
        title: t('analytics.share'),
        dataIndex: 'share',
        key: 'share',
        align: 'right' as const,
        width: 88,
        render: (share: number) => `${Math.round(share * 100)}%`,
      },
    ],
    [columns, t],
  )

  return (
    <div className="package-loss-flow-table">
      <h4 className="package-loss-viz-kicker">{t('analytics.flowTable')}</h4>
      <Table<InHubLossFlowTableRow>
        rowKey="key"
        columns={tableColumns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: t('analytics.noFlowsUnderFilter') }}
        scroll={{ x: true, y: 480 }}
        bordered
      />
    </div>
  )
}
