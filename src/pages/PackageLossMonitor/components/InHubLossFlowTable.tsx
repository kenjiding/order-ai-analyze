import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { FlowTableDimKey, InHubLossFlowTableRow, SankeyColumn } from '../inHubLossAnalytics'

type Props = {
  columns: SankeyColumn[]
  rows: InHubLossFlowTableRow[]
}

export function InHubLossFlowTable({ columns, rows }: Props) {
  const tableColumns: ColumnsType<InHubLossFlowTableRow> = [
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
      title: '单量',
      dataIndex: 'count',
      key: 'count',
      align: 'right',
      width: 88,
    },
    {
      title: '占比',
      dataIndex: 'share',
      key: 'share',
      align: 'right',
      width: 88,
      render: (share: number) => `${Math.round(share * 100)}%`,
    },
  ]

  return (
    <div className="package-loss-flow-table">
      <h4 className="package-loss-viz-kicker">流向明细</h4>
      <Table<InHubLossFlowTableRow>
        rowKey="key"
        columns={tableColumns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '暂无流向明细' }}
        scroll={{ x: true, y: 480 }}
        bordered
      />
    </div>
  )
}
