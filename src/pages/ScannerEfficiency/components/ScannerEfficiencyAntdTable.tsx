import { useTranslation } from 'react-i18next'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { DataTableColumn, DataTableRow } from './ui'

const BOUNDED_SCROLL_Y = 480

type Props = {
  columns: DataTableColumn[]
  rows: DataTableRow[]
  averageRow: DataTableRow | null
  emptyText: string
  boundedScroll?: boolean
}

function toAntdColumns(columns: DataTableColumn[], sortTooltip: string): ColumnsType<DataTableRow> {
  return columns.map((col) => ({
    key: col.key,
    dataIndex: col.key,
    title: col.renderTitle ? col.renderTitle() : col.title,
    width: col.width,
    sorter: col.sorter,
    sortDirections: col.sortDirections,
    defaultSortOrder: col.defaultSortOrder,
    showSorterTooltip: col.sorter ? { title: sortTooltip } : false,
    render: col.render
      ? (_value, record) => col.render!(record)
      : (value) => (value == null || value === '' ? '—' : String(value)),
  }))
}

function renderCell(column: DataTableColumn, row: DataTableRow) {
  return column.render ? column.render(row) : String(row[column.key] ?? '—')
}

/** 扫描员汇总类表格：antd Table + 底部固定「平均」行（summary fixed） */
export function ScannerEfficiencyAntdTable({
  columns,
  rows,
  averageRow,
  emptyText,
  boundedScroll = true,
}: Props) {
  const { t } = useTranslation('scannerEfficiency')

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        {emptyText}
      </div>
    )
  }

  const antdColumns = toAntdColumns(columns, t('common.clickToSort'))

  return (
    <div
      className={[
        'scanner-efficiency-antd-table admin-panel overflow-hidden',
        boundedScroll ? 'scanner-efficiency-antd-table--bounded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Table<DataTableRow>
        className="scanner-efficiency-antd-table__inner"
        columns={antdColumns}
        dataSource={rows}
        pagination={false}
        rowKey={(record, index) => String(record.scanner ?? record.sorterName ?? index)}
        scroll={boundedScroll ? { y: BOUNDED_SCROLL_Y } : undefined}
        summary={
          averageRow
            ? () => (
                <Table.Summary fixed>
                  <Table.Summary.Row className="scanner-efficiency-antd-table__average">
                    {columns.map((col, index) => (
                      <Table.Summary.Cell key={col.key} index={index}>
                        {renderCell(col, averageRow)}
                      </Table.Summary.Cell>
                    ))}
                  </Table.Summary.Row>
                </Table.Summary>
              )
            : undefined
        }
      />
    </div>
  )
}
