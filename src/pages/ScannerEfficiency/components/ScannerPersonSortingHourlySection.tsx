import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import { ChevronDown } from 'lucide-react'
import { buildScannerHourlyPivotColumns, type ScannerHourlyPivotTableItem } from '../scannerHourlyPivotTable'
import { DataTable, SectionTitle } from './ui'

export type ScannerPersonSortingHourlySectionProps = {
  expanded: boolean
  onExpandedChange: (next: boolean) => void
  pivotTables: ScannerHourlyPivotTableItem[]
  sectionEyebrow?: string
  sectionTitle?: string
  sectionDescription?: string
  emptyPivotText?: string
  /** 飞书截图等场景：无折叠控件，内容始终展开 */
  forStaticCapture?: boolean
}

/**
 * 「分拣员个人效率」-tab 内的「扫描员按小时段」：可折叠的按日小时透视表。
 */
export function ScannerPersonSortingHourlySection({
  expanded,
  onExpandedChange,
  pivotTables,
  sectionEyebrow = 'Scanner Hourly',
  sectionTitle = '扫描员按小时段',
  sectionDescription = '',
  emptyPivotText = '暂无按小时段数据。',
  forStaticCapture = false,
}: ScannerPersonSortingHourlySectionProps) {
  const pivotBody = (
    <div className="space-y-6 px-4 pt-1">
      {pivotTables.length === 0 ? (
        <div className="overflow-x-auto">
          <DataTable columns={buildScannerHourlyPivotColumns([])} rows={[]} emptyText={emptyPivotText} />
        </div>
      ) : (
        <div className="space-y-6">
          {pivotTables.map(({ date, hours, rows }) => (
            <div key={date} className="space-y-2">
              <p className="text-sm font-semibold text-slate-800 tabular-nums">{date}</p>
              <div className="overflow-x-auto">
                <DataTable columns={buildScannerHourlyPivotColumns(hours)} rows={rows} emptyText="暂无数据。" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  if (forStaticCapture) {
    return (
      <section className="space-y-4">
        <SectionTitle eyebrow={sectionEyebrow} title={sectionTitle} description={sectionDescription} />
        {pivotBody}
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <SectionTitle eyebrow={sectionEyebrow} title={sectionTitle} description={sectionDescription} />
        </div>
        <IconButton
          size="small"
          aria-expanded={expanded}
          aria-label={expanded ? '收起按小时段表格' : '展开按小时段表格'}
          onClick={() => onExpandedChange(!expanded)}
          sx={{
            mt: 0.5,
            color: 'text.secondary',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
          }}
        >
          <ChevronDown size={22} strokeWidth={2} />
        </IconButton>
      </div>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        {pivotBody}
      </Collapse>
    </section>
  )
}
