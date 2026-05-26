import type { ReactNode } from 'react'

type ExportButtonProps = {
  onClick: () => void
  disabled?: boolean
  label?: string
  className?: string
}

export function ExportButton({
  onClick,
  disabled,
  label = '导出 Excel',
  className,
}: ExportButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={['admin-btn', 'admin-btn-primary', className].filter(Boolean).join(' ')}
    >
      {label}
    </button>
  )
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
}

export function DataTable({ columns, rows, emptyText, boundedScroll }: DataTableProps) {
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
            return (
              <tr key={rowKey}>
                {columns.map((column) => (
                  <td key={column.key}>
                    {column.render ? column.render(row) : String(row[column.key] ?? '')}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
