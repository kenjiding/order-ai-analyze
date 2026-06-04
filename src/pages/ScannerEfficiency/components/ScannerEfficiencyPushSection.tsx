import type { TabsProps } from 'antd'
import { Tabs } from 'antd'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import AttendanceSchedulingPushTab from './AttendanceSchedulingPushTab'
import { SectionTitle } from './ui'

type Props = {
  vm: Pick<
    ScannerEfficiencyViewModel,
    'attendanceResult' | 'attendanceRows' | 'scannerResult' | 'dailyLaborCostByDate'
  >
}

export default function ScannerEfficiencyPushSection({ vm }: Props) {
  const tabPlacement: TabsProps['tabPlacement'] = 'start'

  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        eyebrow="Feishu Push"
        title="推送"
        description="按业务场景预览并排班计划，确认后截图推送到飞书群。"
      />

      <div className="px-5 py-5">
        <Tabs
          tabPlacement={tabPlacement}
          items={[
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
