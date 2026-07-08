import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import type { ScannerLevel1FeishuPush } from '../useScannerLevel1FeishuPush'
import SortEfficiencyPushTab from './SortEfficiencyPushTab'
import { SectionTitle } from './ui'

type Props = {
  vm: Pick<ScannerEfficiencyViewModel, 'attendanceResult' | 'scannerResult'>
  level1Push: ScannerLevel1FeishuPush
}

export default function ScannerEfficiencyPushSection({ vm, level1Push }: Props) {
  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        title="推送"
        description="选择效率图表并截图推送到飞书群；排班计划推送请前往「飞书推送 → 仓库出勤/排班推送」。"
      />

      <div className="px-5 py-5">
        <SortEfficiencyPushTab vm={vm} level1Push={level1Push} />
      </div>
    </section>
  )
}
