import { Button, Empty, Typography } from 'antd'
import { ExternalLink, Ticket } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  isSupplierPushEligible,
  SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH,
  SupplierPushSelectionGrid,
} from '../../../shared/supplierPushConfig'
import type { useWorkOrderPushPage } from '../useWorkOrderPushPage'

type Props = {
  page: ReturnType<typeof useWorkOrderPushPage>
}

export function WorkOrderPushSupplierSection({ page }: Props) {
  const { catalog, scopeBinding, editing, pendingSupplierIds, setPendingSupplierIds } = page

  const eligibleConfigs = useMemo(
    () => catalog.configs.filter(isSupplierPushEligible),
    [catalog.configs],
  )
  const ineligibleCount = catalog.configs.length - eligibleConfigs.length
  const enabledIdSet = useMemo(() => new Set(pendingSupplierIds), [pendingSupplierIds])
  const eligibleIdSet = useMemo(() => new Set(eligibleConfigs.map((c) => c.id)), [eligibleConfigs])
  const selectedPushCount = pendingSupplierIds.filter((id) => eligibleIdSet.has(id)).length
  const allEligibleSelected = eligibleConfigs.length > 0 && selectedPushCount === eligibleConfigs.length

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
        <div>
          <h3 className="admin-title flex items-center gap-1.5 text-base">
            <Ticket className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            供应商配置
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            在「飞书推送 → 车队供应商推送」统一维护 Webhook 与供应商代码；勾选控制定时工单推送范围，
            与上方「定时推送配置」共用「编辑/保存」。
          </p>
        </div>
        {editing && (
          <div className="flex items-center gap-2">
            <Button
              disabled={allEligibleSelected || eligibleConfigs.length === 0}
              onClick={() => setPendingSupplierIds(eligibleConfigs.map((c) => c.id))}
            >
              全选
            </Button>
            <Button
              disabled={selectedPushCount === 0}
              onClick={() => setPendingSupplierIds([])}
            >
              清空
            </Button>
          </div>
        )}
      </div>

      <div className="px-5 py-4">
        {catalog.configs.length === 0 ? (
          <Empty
            className="py-6"
            description={
              <Typography.Text type="secondary">
                暂无供应商配置，请前往「飞书推送 → 车队供应商推送」添加。
              </Typography.Text>
            }
          />
        ) : (
          <SupplierPushSelectionGrid
            configs={catalog.configs}
            enabledIdSet={enabledIdSet}
            disabled={!editing}
            saving={scopeBinding.saving || catalog.loading}
            columns={5}
            onToggle={(id, next) =>
              setPendingSupplierIds(
                next ? [...pendingSupplierIds, id] : pendingSupplierIds.filter((x) => x !== id),
              )
            }
          />
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--admin-line)] pt-3 text-[11px] text-slate-400">
          <span>已选 {selectedPushCount} / {eligibleConfigs.length} 个可推送供应商</span>
          <span className="flex items-center gap-3">
            {ineligibleCount > 0 && <span>{ineligibleCount} 个未配置 Webhook</span>}
            <Link
              to={SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH}
              className="inline-flex items-center gap-1 text-[var(--admin-accent)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />维护配置
            </Link>
          </span>
        </div>
      </div>
    </div>
  )
}
