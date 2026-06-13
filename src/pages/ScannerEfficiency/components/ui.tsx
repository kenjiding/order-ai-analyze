import { Fragment, type ReactNode } from 'react'
import { Tooltip } from 'antd'
import { usePermission } from '../../../hooks/usePermission'

type ExportButtonProps = {
  onClick: () => void
  disabled?: boolean
  label?: string
  className?: string
  permission?: string
}

export function ExportButton({
  onClick,
  disabled,
  label = '导出 Excel',
  className,
  permission,
}: ExportButtonProps) {
  const allowed = permission ? usePermission(permission) : true
  const isDisabled = disabled || !allowed

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={['admin-btn', 'admin-btn-primary', className].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  )

  if (permission && !allowed) {
    return <Tooltip title="无操作权限">{button}</Tooltip>
  }

  return button
}

type SectionTitleProps = {
  eyebrow: string
  title: string
  description: string
  /** 与标题区块同一行区域内靠右展示（如操作按钮） */
  right?: ReactNode
}

export function SectionTitle({ eyebrow, title, description, right }: SectionTitleProps) {
  const main = (
    <>
      <p className="admin-eyebrow">{eyebrow}</p>
      <h2 className="admin-title">{title}</h2>
      <p className="admin-description">{description}</p>
    </>
  )
  if (!right) {
    return <div className="admin-section-title">{main}</div>
  }
  return (
    <div className="admin-section-title flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">{main}</div>
      <div className="shrink-0 pt-0.5 sm:pt-1">{right}</div>
    </div>
  )
}

type MetricProps = {
  label: string
  value: ReactNode
  hint: ReactNode
  tone?: 'light' | 'dark'
}

export function Metric({ label, value, hint, tone = 'light' }: MetricProps) {
  return (
    <div
      className={
        tone === 'dark'
          ? 'rounded-lg border border-[#b8ddd7] bg-[#e1f5f1] p-5 text-slate-950 shadow-[0_18px_48px_rgba(47,83,105,0.08)]'
          : 'admin-panel p-5 text-slate-950'
      }
    >
      <p
        className={
          tone === 'dark'
            ? 'text-xs uppercase tracking-[0.24em] text-slate-600'
            : 'text-xs uppercase tracking-[0.24em] text-slate-500'
        }
      >
        {label}
      </p>
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${tone === 'dark' ? 'text-[#1f6f68]' : 'text-[#2f8f87]'}`}>
        {value}
      </p>
      <p className={tone === 'dark' ? 'mt-2 text-sm text-slate-600' : 'mt-2 text-sm text-slate-500'}>{hint}</p>
    </div>
  )
}

export type DataTableRow = Record<string, unknown>

export type DataTableColumn = {
  key: string
  title: string
  render?: (row: DataTableRow) => ReactNode
}

type DataTableProps = {
  columns: DataTableColumn[]
  rows: DataTableRow[]
  emptyText: string
  /** 限制表格区域高度并在内部滚动（适合按月等长列表）；表头 sticky */
  boundedScroll?: boolean
  /** 行是否可展开（如周汇总行） */
  isRowExpandable?: (row: DataTableRow) => boolean
  isRowExpanded?: (row: DataTableRow) => boolean
  getExpandedChildRows?: (row: DataTableRow) => DataTableRow[] | undefined
  onRowClick?: (row: DataTableRow) => void
}

function resolveRowClassName(row: DataTableRow, options?: { clickable?: boolean; child?: boolean }): string {
  const classes: string[] = []
  if (row.isWeekGroupHeader) classes.push('bg-slate-100/90')
  else if (row.isWeekGroupFooter) classes.push('bg-slate-50/95')
  else if (row.isAttendanceMatchFooter) classes.push('bg-slate-100/80')
  else if (row.isTableAverageRow) classes.push('bg-slate-100/80 font-medium')
  else if (options?.child) classes.push('bg-white')
  if (options?.clickable) classes.push('cursor-pointer hover:bg-slate-100/70')
  return classes.join(' ')
}

function renderTableCell(
  column: DataTableColumn,
  row: DataTableRow,
  columnIndex: number,
  options?: { expandable?: boolean; expanded?: boolean; child?: boolean },
) {
  const content = column.render ? column.render(row) : String(row[column.key] ?? '')
  if (columnIndex === 0 && options?.expandable) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={[
            'inline-flex h-4 w-4 shrink-0 items-center justify-center text-[10px] text-slate-400 transition-transform',
            options.expanded ? 'rotate-90' : '',
          ].join(' ')}
          aria-hidden
        >
          ▶
        </span>
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    )
  }
  if (columnIndex === 0 && options?.child) {
    return <div className="pl-6">{content}</div>
  }
  return content
}

export function DataTable({
  columns,
  rows,
  emptyText,
  boundedScroll,
  isRowExpandable,
  isRowExpanded,
  getExpandedChildRows,
  onRowClick,
}: DataTableProps) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        {emptyText}
      </div>
    )
  }

  return (
    <div
      className={[
        'data-table admin-panel',
        boundedScroll ? 'data-table--bounded' : 'overflow-x-auto',
      ].join(' ')}
    >
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = row.id != null ? String(row.id) : `${index}`
            const expandable = Boolean(isRowExpandable?.(row))
            const expanded = expandable && Boolean(isRowExpanded?.(row))
            const childRows = expanded ? (getExpandedChildRows?.(row) ?? []) : []
            const clickable = expandable && Boolean(onRowClick)

            return (
              <Fragment key={rowKey}>
                <tr
                  className={resolveRowClassName(row, { clickable })}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onRowClick?.(row)
                          }
                        }
                      : undefined
                  }
                  aria-expanded={expandable ? expanded : undefined}
                >
                  {columns.map((column, columnIndex) => (
                    <td key={column.key}>
                      {renderTableCell(column, row, columnIndex, {
                        expandable,
                        expanded,
                      })}
                    </td>
                  ))}
                </tr>
                {childRows.map((childRow, childIndex) => {
                  const childKey =
                    childRow.id != null
                      ? `child-${String(childRow.id)}`
                      : `child-${rowKey}-${childIndex}`
                  return (
                    <tr key={childKey} className={resolveRowClassName(childRow, { child: true })}>
                      {columns.map((column, columnIndex) => (
                        <td key={column.key}>
                          {renderTableCell(column, childRow, columnIndex, { child: true })}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
