import type { ReactNode } from 'react'
import ScannerSummaryBarChart, { type ScannerSummaryChartRow } from '../ScannerSummaryBarChart'
import { DataTable, SectionTitle } from './ui'
import type { DataTableColumn, DataTableRow } from './ui'

export type ScannerPersonSortingSummarySectionProps = {
  columns: DataTableColumn[]
  /** 与柱状图同源；一般由 `scannerResult.scannerTotalRows` 传入（表与图共用口径） */
  scannerTotalRows: ScannerSummaryChartRow[]
  boundedScroll?: boolean
  emptyTableText?: string
  /** SectionTitle.copy 覆写（推送等场景可调） */
  sectionEyebrow?: string
  sectionTitle?: string
  sectionDescription?: string
  /** 紧邻「扫描员一级分拣效率汇总」标题右侧区域 */
  sectionTitleRight?: ReactNode
}

/**
 * 「一级分拣个人效率」-tab 内的「扫描员一级分拣效率汇总」：表格 + 修正效率柱状图。
 */
export function ScannerPersonSortingSummarySection({
  columns,
  scannerTotalRows,
  boundedScroll = true,
  emptyTableText = '暂无扫描员汇总。',
  sectionEyebrow = 'Scanner Summary',
  sectionTitle = '扫描员一级分拣效率汇总',
  sectionDescription = '按扫描员汇总总扫描量、推算有效工时、原始总效率与按样本可靠度回归后的修正效率（团队基准=一级分拣整体效率）。',
  sectionTitleRight,
}: ScannerPersonSortingSummarySectionProps) {
  const rows = scannerTotalRows as unknown as DataTableRow[]
  return (
    <section className="space-y-4">
      <SectionTitle
        eyebrow={sectionEyebrow}
        title={sectionTitle}
        description={sectionDescription}
        right={sectionTitleRight}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
        <div className="min-w-0 px-4">
          <DataTable boundedScroll={boundedScroll} columns={columns} rows={rows} emptyText={emptyTableText} />
        </div>
        <div className="admin-panel min-w-0 overflow-hidden p-4 sm:p-5">
          <ScannerSummaryBarChart rows={scannerTotalRows} />
        </div>
      </div>
    </section>
  )
}
