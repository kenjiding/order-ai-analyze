import type { ReactNode } from 'react'
import ScannerSummaryBarChart, { type ScannerSummaryChartRow } from '../ScannerSummaryBarChart'
import { useTranslation } from 'react-i18next'
import { buildScannerPersonSummaryAverageRow } from '../scannerSummaryTableFooter'
import { ScannerEfficiencyAntdTable } from './ScannerEfficiencyAntdTable'
import { SectionTitle } from './ui'
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
 * 「分拣员个人效率」-tab 内的「扫描员一级分拣效率汇总」：表格 + 修正效率柱状图。
 */
export function ScannerPersonSortingSummarySection({
  columns,
  scannerTotalRows,
  boundedScroll = true,
  emptyTableText,
  sectionEyebrow,
  sectionTitle,
  sectionDescription = '',
  sectionTitleRight,
}: ScannerPersonSortingSummarySectionProps) {
  const { t } = useTranslation('scannerEfficiency')
  const bodyRows = scannerTotalRows as unknown as DataTableRow[]
  const averageRow = buildScannerPersonSummaryAverageRow(scannerTotalRows)
  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        kicker={sectionEyebrow}
        title={sectionTitle ?? t('section.scannerSummaryTitle')}
        description={sectionDescription}
        right={sectionTitleRight}
      />
      <div className="grid gap-4 p-4 pt-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
        <div className="min-w-0">
          <ScannerEfficiencyAntdTable
            boundedScroll={boundedScroll}
            columns={columns}
            rows={bodyRows}
            averageRow={averageRow}
            emptyText={emptyTableText ?? t('empty.noScannerSummary')}
          />
        </div>
        <div className="admin-panel min-w-0 overflow-hidden p-4 sm:p-5">
          <ScannerSummaryBarChart rows={scannerTotalRows} />
        </div>
      </div>
    </section>
  )
}
