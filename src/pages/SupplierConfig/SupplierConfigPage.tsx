import { Truck } from 'lucide-react'
import { SupplierConfigManager } from './components/SupplierConfigManager'

export default function SupplierConfigPage() {
  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Supplier</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Truck className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              供应商配置
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              全局维护供应商的路由、站点、飞书群与专属推送文案；各推送业务（车队供应商推送、出仓/派签告警、催派、工单等）只勾选推送对象，不再单独维护配置。
            </p>
          </div>
        </div>
        <div className="border-t border-[var(--admin-line)] px-5 py-5">
          <SupplierConfigManager />
        </div>
      </div>
    </div>
  )
}
