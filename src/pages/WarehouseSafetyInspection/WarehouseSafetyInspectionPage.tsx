import { ClipboardCheck } from 'lucide-react'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { DailyChecklistTable } from './components/DailyChecklistTable'
import { useDailyChecklistForm } from './useDailyChecklistForm'

const SECTION_TABS = [{ id: 'daily', label: '日常检查表（一）' }]

export default function WarehouseSafetyInspectionPage() {
  const dailyVm = useDailyChecklistForm()
  const activeTab = 'daily'

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">仓库安全日常检查</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              按检查要点逐项自查，默认无风险以减少录入；佐证照片仅存于浏览器，导出 Excel 时一并写入。
            </p>
          </div>
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <PageSectionTabs
          activeId={activeTab}
          items={SECTION_TABS}
          onChange={() => {
            /* 后续扩展更多检查表 */
          }}
        />
        <div className="p-4 sm:p-5">
          <DailyChecklistTable vm={dailyVm} />
        </div>
      </section>
    </div>
  )
}
