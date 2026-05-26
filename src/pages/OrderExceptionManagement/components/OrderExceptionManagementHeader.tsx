import { ClipboardList, PackageSearch } from 'lucide-react'
import { PageSectionTabs } from '../../../components/PageSectionTabs'
import type { PageSectionTabItem } from '../../../components/PageSectionTabs'
import type { TabId } from '../useOrderExceptionManagementPage'

type Props = {
  activeTab: TabId
  onTabChange: (id: TabId) => void
}

const tabItems: PageSectionTabItem[] = [
  { id: 'analyze', label: '异常订单分析', icon: PackageSearch },
  { id: 'regression', label: '测试用例', icon: ClipboardList },
]

export function OrderExceptionManagementHeader({
  activeTab,
  onTabChange,
}: Props) {
  return (
    <div className="admin-panel overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="admin-eyebrow">Exception Operations</div>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
              <PackageSearch className="h-5 w-5 text-[#2f8f87]" aria-hidden />
              订单异常管理
            </h2>
          </div>
        </div>
      </div>

      <PageSectionTabs
        activeId={activeTab}
        onChange={(id: string) => onTabChange(id as TabId)}
        items={tabItems}
      />
    </div>
  )
}
