import type { TabsProps } from 'antd'
import { Tabs } from 'antd'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import type { ScannerLevel1FeishuPush } from '../useScannerLevel1FeishuPush'
import AttendanceSchedulingPushTab from './AttendanceSchedulingPushTab'
import SortEfficiencyPushTab from './SortEfficiencyPushTab'
import { SectionTitle } from './ui'

type Props = {
  vm: Pick<
    ScannerEfficiencyViewModel,
    'attendanceResult' | 'attendanceRows' | 'scannerResult' | 'dailyLaborCostByDate'
  >
  level1Push: ScannerLevel1FeishuPush
}

export default function ScannerEfficiencyPushSection({ vm, level1Push }: Props) {
  const tabPlacement: TabsProps['tabPlacement'] = 'start'

  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        eyebrow="Feishu Push"
        title="推送"
        description="配置效率图表或预览排班计划，确认后截图推送到飞书群。"
      />

      <div className="px-5 py-5">
        <Tabs
          tabPlacement={tabPlacement}
          items={[
            {
              key: 'sort_efficiency',
              label: '效率图表推送',
              children: <SortEfficiencyPushTab vm={vm} level1Push={level1Push} />,
            },
            {
              key: 'attendance_scheduling',
              label: '排班推送',
              children: <AttendanceSchedulingPushTab vm={vm} />,
            },
          ]}
        />
      </div>
    </section>
  )
}
