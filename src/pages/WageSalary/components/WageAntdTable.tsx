// @ts-nocheck
import { Table } from 'antd'

const DEFAULT_SCROLL_Y = 480

type Props = {
  columns
  dataSource
  rowKey
  pagination?
  summary?
  scrollX?
  scrollY?
  rowClassName?
  onTableChange?
}

/** 工资页 antd Table：与扫描效率表统一样式，支持横向滚动与右侧固定列 */
export function WageAntdTable({
  columns,
  dataSource,
  rowKey,
  pagination = false,
  summary,
  scrollX = 1200,
  scrollY = DEFAULT_SCROLL_Y,
  rowClassName,
  onTableChange,
}) {
  return (
    <div className="wage-antd-table overflow-hidden rounded-lg border border-slate-200">
      <Table
        className="wage-antd-table__inner"
        columns={columns}
        dataSource={dataSource}
        rowKey={rowKey}
        size="small"
        pagination={pagination}
        scroll={{ x: scrollX, y: scrollY }}
        summary={summary}
        rowClassName={rowClassName}
        onChange={(pag) => onTableChange?.(pag)}
      />
    </div>
  )
}
