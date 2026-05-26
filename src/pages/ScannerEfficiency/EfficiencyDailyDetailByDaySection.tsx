import DailyEfficiencyComboChart, {
  type DailyEfficiencyBubbleDatum,
} from './DailyEfficiencyBubbleChart'
import { DataTable, SectionTitle } from './components/ui'
import type { DataTableColumn, DataTableRow } from './components/ui'

const FULL_SECTION_DESCRIPTION =
  '左侧为明细表；「总工时(h)」可直接编辑改正，修改后立即重算当日效率、末行汇总与顶部开仓/总体效率。右侧为组合图：蓝色柱为总货量（左轴），绿色面积折线为总工时（独立比例尺，各自充满高度便于看趋势），橙线为当天效率（右轴），悬停可查看每票成本，仅含已匹配效率的日期。表格末行仍为总计与按日平均。'

const TABLE_ONLY_DESCRIPTION =
  '到件与考勤匹配后的按日效率明细（与页内「效率明细/天」表口径一致）。'

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
          description={TABLE_ONLY_DESCRIPTION}
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
        description={FULL_SECTION_DESCRIPTION}
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
