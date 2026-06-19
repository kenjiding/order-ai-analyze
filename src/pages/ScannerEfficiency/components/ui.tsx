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
  /** 可选分类标签；页面内不宜过多使用 */
  kicker?: string
  /** @deprecated 使用 kicker */
  eyebrow?: string
  title: string
  description?: string
  /** 嵌入告警等有色容器时，省略区块顶部分割样式 */
  bare?: boolean
  /** 与标题区块同一行区域内靠右展示（如操作按钮） */
  right?: ReactNode
}

export function SectionTitle({ kicker, eyebrow, title, description, bare, right }: SectionTitleProps) {
  const sectionKicker = kicker ?? eyebrow
  const main = (
    <>
      {sectionKicker ? <p className="se-section-kicker">{sectionKicker}</p> : null}
      <h2 className={sectionKicker ? 'se-section-title' : 'se-section-title mt-0'}>{title}</h2>
      {description ? <p className="se-section-desc">{description}</p> : null}
    </>
  )
  const headClass = bare ? 'px-5 py-4' : 'se-section-head'
  if (!right) {
    return <div className={headClass}>{main}</div>
  }
  return (
    <div className={`${headClass} flex flex-wrap items-start justify-between gap-4`}>
      <div className="min-w-0 flex-1">{main}</div>
      <div className="shrink-0 pt-0.5">{right}</div>
    </div>
  )
}

type MetricProps = {
  label: string
  value: ReactNode
  hint: ReactNode
  featured?: boolean
}

export function Metric({ label, value, hint, featured = false }: MetricProps) {
  return (
    <div className={['se-metric', featured ? 'se-metric--featured' : ''].filter(Boolean).join(' ')}>
      <p className="se-metric-label">{label}</p>
      <p className="se-metric-value">{value}</p>
      <p className="se-metric-hint">{hint}</p>
    </div>
  )
}

export function LoadingPanel() {
  return (
    <section className="se-loading-panel" aria-busy="true" aria-label="正在加载">
      <div className="flex flex-col gap-3">
        <div className="se-skeleton h-4 w-40" />
        <div className="se-skeleton h-3 w-full max-w-md" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-[var(--admin-line)] p-4">
            <div className="se-skeleton h-3 w-24" />
            <div className="se-skeleton mt-3 h-8 w-28" />
            <div className="se-skeleton mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-[var(--admin-muted)]">正在读取并计算，请稍候…</p>
    </section>
  )
}

export type DataTableRow = Record<string, unknown>

export type DataTableColumn = {
  key: string
  title: string
  /** 自定义表头渲染；优先于 title */
  renderTitle?: () => ReactNode
  render?: (row: DataTableRow) => ReactNode
}

type DataTableProps = {
  columns: DataTableColumn[]
  rows: DataTableRow[]
  emptyText: string
  /** 限制表格区域高度并在内部滚动（适合按月等长列表）；表头 sticky */
  boundedScroll?: boolean
  /** 与 boundedScroll 联用，覆盖默认 max-height（px） */
  boundedScrollMaxHeight?: number
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
  boundedScrollMaxHeight,
  isRowExpandable,
  isRowExpanded,
  getExpandedChildRows,
  onRowClick,
}: DataTableProps) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-6 py-10 text-center text-sm text-[var(--admin-muted)]">
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
      style={boundedScroll && boundedScrollMaxHeight != null ? { maxHeight: boundedScrollMaxHeight } : undefined}
    >
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>
                {column.renderTitle ? column.renderTitle() : column.title}
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
