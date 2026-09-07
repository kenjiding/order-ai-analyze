import { useTranslation } from 'react-i18next'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import type { ScannerLevel1FeishuPush } from '../useScannerLevel1FeishuPush'
import SortEfficiencyPushTab from './SortEfficiencyPushTab'
import { SectionTitle } from './ui'

type Props = {
  vm: Pick<ScannerEfficiencyViewModel, 'attendanceResult' | 'scannerResult'>
  level1Push: ScannerLevel1FeishuPush
}

export default function ScannerEfficiencyPushSection({ vm, level1Push }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  return (
    <section className="admin-panel overflow-hidden">
      <SectionTitle
        title={t('section.pushTitle')}
        description=""
      />

      <div className="px-5 py-5">
        <SortEfficiencyPushTab vm={vm} level1Push={level1Push} />
      </div>
    </section>
  )
}
