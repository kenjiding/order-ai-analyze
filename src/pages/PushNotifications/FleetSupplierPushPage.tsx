import { Truck } from 'lucide-react'
import { SupplierConfigManager } from '../SupplierConfig/components/SupplierConfigManager'
import { FleetSupplierPushTab } from './components/FleetSupplierPushTab'

export default function FleetSupplierPushPage() {
  return (
    <div className="admin-shell min-h-screen">
      <header className="admin-topbar">
        <div className="mx-auto flex w-full max-w-[1680px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Truck className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
          <span className="text-sm font-semibold text-slate-800">车队供应商推送</span>
        </div>
      </header>

      <main className="admin-page space-y-5">
        <div className="admin-panel overflow-hidden">
          <div className="admin-section-title bg-[var(--admin-surface-soft)]">
            <div>
              <div className="admin-eyebrow">Fleet Supplier</div>
              <h2 className="admin-title mt-1 flex items-center gap-2">
                <Truck className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
                车队供应商推送
              </h2>
            </div>
          </div>
          <div className="border-t border-[var(--admin-line)] px-5 py-5">
            <FleetSupplierPushTab />
          </div>
        </div>

        {/* 独立入口页没有系统管理菜单，配置维护直接内嵌于此（不展示 webhook / 密钥） */}
        <div className="admin-panel overflow-hidden">
          <div className="admin-section-title bg-[var(--admin-surface-soft)]">
            <div>
              <div className="admin-eyebrow">Supplier</div>
              <h2 className="admin-title mt-1">供应商配置</h2>
            </div>
          </div>
          <div className="border-t border-[var(--admin-line)] px-5 py-5">
            <SupplierConfigManager secretsVisibility="hidden" />
          </div>
        </div>
      </main>
    </div>
  )
}
