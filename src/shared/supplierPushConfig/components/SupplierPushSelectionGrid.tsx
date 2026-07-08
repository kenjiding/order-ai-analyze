import { Checkbox, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { isSupplierPushEligible } from '../selection'
import type { SupplierPushConfig } from '../types'

type Props = {
  configs: SupplierPushConfig[]
  enabledIdSet: ReadonlySet<string>
  onToggle: (configId: string, next: boolean) => void
  /** 只读展示（不可勾选），但仍反映 enabledIdSet 的选中态 */
  disabled?: boolean
  togglingId?: string | null
  saving?: boolean
  emptyText?: ReactNode
  /** 大屏下每行展示的卡片数，默认 4（抽屉等较窄容器） */
  columns?: 4 | 5
}

const COLUMNS_CLASS: Record<4 | 5, string> = {
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
}

/**
 * 供应商推送多选：卡片网格样式，重点展示供应商昵称与供应商名。
 * 选中即代表会被推送；未配置 Webhook 的供应商禁用（无法推送），并给出提示。
 */
export function SupplierPushSelectionGrid({
  configs,
  enabledIdSet,
  onToggle,
  disabled = false,
  togglingId = null,
  saving = false,
  emptyText = '暂无供应商配置，请前往「飞书推送」维护。',
  columns = 4,
}: Props) {
  if (configs.length === 0) {
    return <p className="text-xs text-slate-400">{emptyText}</p>
  }
  return (
    <div className={`grid grid-cols-2 gap-2 ${COLUMNS_CLASS[columns]}`}>
      {configs.map((c) => {
        const checked = enabledIdSet.has(c.id)
        const eligible = isSupplierPushEligible(c)
        // 保存期间禁用其余卡片，避免并发切换丢失点击（scope 一次只处理一个）
        const busy = saving && togglingId !== c.id
        const itemDisabled = disabled || !eligible || busy
        const nickname = c.supplierNickname?.trim()
        const primary = nickname || c.vendorName || '未知供应商'
        const showVendorLine = !!nickname && c.vendorName.trim().length > 0

        const checkboxNode = (
          <Checkbox
            checked={checked}
            disabled={itemDisabled}
            onChange={(e) => onToggle(c.id, e.target.checked)}
            className="flex w-full min-w-0 items-center [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:overflow-hidden"
          >
            <span className="flex min-w-0 flex-col leading-tight">
              <Tooltip title={primary}>
                <span className={`truncate text-[13px] font-semibold ${eligible ? 'text-slate-800' : 'text-slate-400'}`}>
                  {primary}
                </span>
              </Tooltip>
              {showVendorLine && (
                <Tooltip title={c.vendorName}>
                  <span className={`truncate text-[11px] font-medium ${eligible ? 'text-[var(--admin-accent)]' : 'text-slate-400'}`}>
                    {c.vendorName}
                  </span>
                </Tooltip>
              )}
            </span>
          </Checkbox>
        )

        return (
          <label
            key={c.id}
            className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-3 py-2.5 transition-colors ${
              !eligible
                ? 'cursor-default border-[var(--admin-line)] bg-[var(--admin-surface-soft)]'
                : checked
                  ? 'cursor-pointer border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
                  : 'cursor-pointer border-[var(--admin-line)] bg-white hover:bg-slate-50'
            }`}
          >
            {eligible ? (
              checkboxNode
            ) : (
              <Tooltip title="该供应商未配置 Webhook，无法推送">
                <span className="flex w-full min-w-0">{checkboxNode}</span>
              </Tooltip>
            )}
          </label>
        )
      })}
    </div>
  )
}
