import ScannerTotalEfficiencyBarChart from '../ScannerTotalEfficiencyBarChart'
import { useTranslation } from 'react-i18next'
import { buildScannerTotalEfficiencyAverageRow } from '../scannerSummaryTableFooter'
import type { ScannerTotalEfficiencyRow } from '../sortingLookup'
import { ScannerEfficiencyAntdTable } from './ScannerEfficiencyAntdTable'
import { SectionTitle } from './ui'
import type { DataTableColumn, DataTableRow } from './ui'

export type ScannerPersonTotalEfficiencySectionProps = {
  columns: DataTableColumn[]
  rows: ScannerTotalEfficiencyRow[]
  boundedScroll?: boolean
  emptyTableText?: string
}

/**
 * 「分拣员个人效率」-tab 内的「分拣员总效率」：扫描量 ÷ 考勤总工时，表格 + 柱状图。
 */
export function ScannerPersonTotalEfficiencySection({
  columns,
  rows,
  boundedScroll = true,
  emptyTableText,
}: ScannerPersonTotalEfficiencySectionProps) {
  const { t } = useTranslation('scannerEfficiency')
  const bodyRows = rows as unknown as DataTableRow[]
  const averageRow = buildScannerTotalEfficiencyAverageRow(rows)

  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        title={t('section.scannerTotalEffTitle')}
        description={t('section.scannerTotalEffDesc')}
      />
      <div className="grid gap-4 p-4 pt-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
        <div className="min-w-0">
          <ScannerEfficiencyAntdTable
            boundedScroll={boundedScroll}
            columns={columns}
            rows={bodyRows}
            averageRow={averageRow}
            emptyText={emptyTableText ?? t('empty.noScannerTotalEff')}
          />
        </div>
        <div className="admin-panel min-w-0 overflow-hidden p-4 sm:p-5">
          <ScannerTotalEfficiencyBarChart rows={rows} />
        </div>
      </div>
    </section>
  )
}
