import { Button } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { isSupplierPushEligible } from '../selection'
import type { SupplierPushConfig } from '../types'

export type ScopeEnableColumnBinding = {
  enabledIds: string[]
  onToggle: (configId: string, enabled: boolean) => unknown
  togglingId?: string | null
  saving?: boolean
}

export function renderScopeStatus(
  row: Pick<SupplierPushConfig, 'id' | 'webhookUrl'>,
  binding: ScopeEnableColumnBinding,
) {
  if (!isSupplierPushEligible(row)) {
    return (
      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
        未配置
      </span>
    )
  }
  const enabled = binding.enabledIds.includes(row.id)
  if (enabled) {
    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        已启用
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
      已禁用
    </span>
  )
}

/** 本业务 scope 下的启用状态（只读展示） */
export function buildScopeStatusColumn(
  binding: ScopeEnableColumnBinding,
  options?: { width?: number },
): ColumnsType<SupplierPushConfig>[number] {
  return {
    title: '状态',
    key: 'scopeStatus',
    width: options?.width ?? 96,
    render: (_, row) => renderScopeStatus(row, binding),
  }
}

/** 状态 + 操作（操作列固定右侧） */
export function buildScopeStatusAndActionsColumns(
  binding: ScopeEnableColumnBinding,
): ColumnsType<SupplierPushConfig> {
  return [buildScopeStatusColumn(binding), buildScopeActionsColumn(binding)]
}

export function renderScopeEnableAction(
  row: Pick<SupplierPushConfig, 'id' | 'webhookUrl'>,
  binding: ScopeEnableColumnBinding,
) {
  const enabled = binding.enabledIds.includes(row.id)
  const eligible = isSupplierPushEligible(row)
  const rowBusy = binding.togglingId === row.id
  const disabled = !eligible || rowBusy || binding.saving === true
  if (!eligible) {
    return <span className="text-slate-400">—</span>
  }
  return (
    <Button
      type="link"
      className={enabled ? '!px-1' : '!px-1 !text-emerald-600 hover:!text-emerald-700'}
      danger={enabled}
      disabled={disabled}
      loading={rowBusy}
      onClick={() => void binding.onToggle(row.id, !enabled)}
    >
      {enabled ? '禁用' : '启用'}
    </Button>
  )
}

/** 业务 scope 启用/禁用，放在表格最后一列「操作」 */
export function buildScopeActionsColumn(
  binding: ScopeEnableColumnBinding,
  options?: { width?: number },
): ColumnsType<SupplierPushConfig>[number] {
  return {
    title: '操作',
    key: 'actions',
    width: options?.width ?? 88,
    fixed: 'right',
    onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }),
    render: (_, row) => (
      <div className="flex flex-nowrap items-center gap-0">
        {renderScopeEnableAction(row, binding)}
      </div>
    ),
  }
}
