import { SupplierPushConfigPanel } from '../../../shared/supplierPushConfig'
import type { useChaseDispatchPage } from '../useChaseDispatchPage'

const CHASE_DISPATCH_SCHEDULED_SCOPE = 'chase-dispatch.scheduled' as const

type Props = {
  page: ReturnType<typeof useChaseDispatchPage>
}

export function ChaseDispatchSupplierSection({ page }: Props) {
  return (
    <SupplierPushConfigPanel
      configs={page.catalog.configs}
      loading={page.catalog.loading || page.scopeBinding.loading}
      title="供应商配置"
      description="在「飞书推送 → 车队供应商推送」统一维护 Webhook 与供应商代码；本页「启用/禁用」控制定时催派推送范围。立即推送请在下方单独勾选供应商。"
      scopeBinding={{
        scopeKey: CHASE_DISPATCH_SCHEDULED_SCOPE,
        enabledIds: page.scopeBinding.enabledIds,
        onToggle: page.scopeBinding.toggle,
        togglingId: page.scopeBinding.togglingId,
        saving: page.scopeBinding.saving,
      }}
    />
  )
}
