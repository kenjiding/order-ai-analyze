import DailyEfficiencyComboChart, {
  type DailyEfficiencyBubbleDatum,
} from './DailyEfficiencyBubbleChart'
import { DataTable, SectionTitle } from './components/ui'
import type { DataTableColumn, DataTableRow } from './components/ui'

export type EfficiencyDailyDetailByDaySectionProps = {
  variant: 'full' | 'tableOnly'
  attendanceMatchColumns: DataTableColumn[]
  attendanceDailyAsTable: DataTableRow[]
  attendanceDayEfficiencyBubbleData: DailyEfficiencyBubbleDatum[]
}

export function EfficiencyDailyDetailByDaySection({
  variant,
  attendanceMatchColumns,
  attendanceDailyAsTable,
  attendanceDayEfficiencyBubbleData,
}: EfficiencyDailyDetailByDaySectionProps) {
  if (variant === 'tableOnly') {
    return (
      <section className="space-y-4">
        <SectionTitle
          eyebrow="Attendance Matching"
          title="效率明细/天"
          description={''}
        />
        <div className="min-w-0 overflow-x-auto px-4">
          <DataTable
            columns={attendanceMatchColumns}
            rows={attendanceDailyAsTable}
            emptyText="暂无日期匹配数据。"
          />
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <SectionTitle
        eyebrow="Attendance Matching"
        title="效率明细/天"
        description={''}
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
        <div className="min-w-0 overflow-x-auto px-4">
          <DataTable
            columns={attendanceMatchColumns}
            rows={attendanceDailyAsTable}
            emptyText="暂无日期匹配数据。"
          />
        </div>
        <div className="admin-panel min-w-0 overflow-hidden p-4 sm:p-5">
          <DailyEfficiencyComboChart data={attendanceDayEfficiencyBubbleData} />
        </div>
      </div>
    </section>
  )
}
