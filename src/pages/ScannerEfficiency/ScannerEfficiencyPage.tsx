import ScannerEfficiencyBody from './components/ScannerEfficiencyBody'
import ScannerEfficiencyTopSection from './components/ScannerEfficiencyTopSection'
import { useScannerEfficiencyPage } from './useScannerEfficiencyPage'
import { useScannerLevel1FeishuPush } from './useScannerLevel1FeishuPush'

export default function ScannerEfficiencyPage() {
  const vm = useScannerEfficiencyPage()
  const level1Push = useScannerLevel1FeishuPush(vm)

  return (
    <div className="admin-page">
      <main className="space-y-5">
        <ScannerEfficiencyTopSection vm={vm} />
        <ScannerEfficiencyBody vm={vm} level1Push={level1Push} />
      </main>
    </div>
  )
}
