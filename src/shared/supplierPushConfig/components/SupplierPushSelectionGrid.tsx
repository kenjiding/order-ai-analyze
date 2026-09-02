import { Button, Checkbox, Tooltip } from 'antd'
import { useMemo, type ReactNode } from 'react'
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
  /**
   * 是否要求供应商「可推送」（配了 Webhook 或飞书群 Chat ID）才允许勾选，默认 true。
   * 纯统计类表单（出仓派签达成分析）不推送任何消息，必须传 false —— 否则没配推送渠道的
   * 供应商永远勾不上，那家的单会被静默排除在统计范围外、历史数据永久缺失。
   */
  requirePushable?: boolean
}

const COLUMNS_CLASS: Record<4 | 5, string> = {
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
}

/**
 * 供应商推送多选：卡片网格样式，重点展示供应商昵称与供应商名。
 * 选中即代表会被推送；未配置 Webhook 也未配置飞书群 Chat ID 的供应商禁用（无法推送），并给出提示。
 */
export function SupplierPushSelectionGrid({
  configs,
  enabledIdSet,
  onToggle,
  disabled = false,
  togglingId = null,
  saving = false,
  emptyText = '暂无供应商配置，请前往「系统管理 → 供应商配置」维护。',
  columns = 4,
  requirePushable = true,
}: Props) {
  const duplicateVendorCodeSet = useMemo(() => {
    const counts = new Map<string, number>()
    for (const config of configs) {
      const code = config.vendorCode.trim()
      if (!code) continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([code]) => code),
    )
  }, [configs])

  if (configs.length === 0) {
    return <p className="text-xs text-slate-400">{emptyText}</p>
  }

  return (
    <div className={`grid grid-cols-2 gap-2 ${COLUMNS_CLASS[columns]}`}>
      {configs.map((c) => {
        const checked = enabledIdSet.has(c.id)
        const eligible = !requirePushable || isSupplierPushEligible(c)
        // 保存期间禁用其余卡片，避免并发切换丢失点击（scope 一次只处理一个）
        const busy = saving && togglingId !== c.id
        const itemDisabled = disabled || !eligible || busy
        const nickname = c.supplierNickname?.trim()
        const primary = nickname || c.vendorName || '未知供应商'
        const showVendorLine = !!nickname && c.vendorName.trim().length > 0
        const isDuplicateVendor = duplicateVendorCodeSet.has(c.vendorCode.trim())
        const routeCode = c.routeCode.trim()
        const stationCode = c.stationCode?.trim() ?? ''
        // 同编码多条时展示路由/站点，避免勾错后推送被服务端按站点过滤掉
        const showRouteLine = isDuplicateVendor && routeCode.length > 0
        const showStationLine = isDuplicateVendor && stationCode.length > 0

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
              {showStationLine && (
                <Tooltip title={stationCode}>
                  <span className={`truncate text-[10px] ${eligible ? 'text-slate-500' : 'text-slate-400'}`}>
                    站点 {stationCode}
                  </span>
                </Tooltip>
              )}
              {showRouteLine && (
                <Tooltip title={routeCode}>
                  <span className={`truncate text-[10px] ${eligible ? 'text-slate-500' : 'text-slate-400'}`}>
                    路由 {routeCode}
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
              <Tooltip title="该供应商未配置 Webhook 或飞书群 Chat ID，无法推送">
                <span className="flex w-full min-w-0">{checkboxNode}</span>
              </Tooltip>
            )}
          </label>
        )
      })}
    </div>
  )
}

type SelectAllButtonsProps = {
  configs: SupplierPushConfig[]
  enabledIdSet: ReadonlySet<string>
  onToggle: (configId: string, next: boolean) => void
  disabled?: boolean
  saving?: boolean
  /** 同 SupplierPushSelectionGrid.requirePushable，两者必须传一致的值 */
  requirePushable?: boolean
  /**
   * 一次性替换整份选择。**受控父组件（onChange 直接读 props.value）必须传它** ——
   * 逐条调 onToggle 时每次回调读到的都是同一份 stale value，只有最后一次生效，
   * 全选/清空看起来「没反应」。用函数式 setState 的调用方可以不传。
   */
  onBulkChange?: (ids: string[]) => void
}

/**
 * 配合 SupplierPushSelectionGrid 使用的「全选/清空」按钮，放在 FormSection 标题右侧（action 插槽）。
 * 全选只勾选已配置 Webhook 或飞书群 Chat ID（可推送）的供应商；清空会取消当前所有已勾选项。
 */
export function SupplierPushSelectAllButtons({
  configs,
  enabledIdSet,
  onToggle,
  disabled = false,
  saving = false,
  requirePushable = true,
  onBulkChange,
}: SelectAllButtonsProps) {
  const eligibleConfigs = useMemo(
    () => (requirePushable ? configs.filter(isSupplierPushEligible) : configs),
    [configs, requirePushable],
  )
  const selectedEligibleCount = eligibleConfigs.filter((c) => enabledIdSet.has(c.id)).length
  const allEligibleSelected = eligibleConfigs.length > 0 && selectedEligibleCount === eligibleConfigs.length
  const controlsDisabled = disabled || saving

  const handleSelectAll = () => {
    if (onBulkChange) {
      onBulkChange([...new Set([...enabledIdSet, ...eligibleConfigs.map((c) => c.id)])])
      return
    }
    for (const c of eligibleConfigs) {
      if (!enabledIdSet.has(c.id)) onToggle(c.id, true)
    }
  }
  const handleClear = () => {
    if (onBulkChange) {
      // 只清掉本目录里的 id，目录外的历史 id 交给提交时统一过滤，与逐条清空的语义一致
      const catalogIds = new Set(configs.map((c) => c.id))
      onBulkChange([...enabledIdSet].filter((id) => !catalogIds.has(id)))
      return
    }
    for (const c of configs) {
      if (enabledIdSet.has(c.id)) onToggle(c.id, false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleSelectAll}
        disabled={controlsDisabled || allEligibleSelected || eligibleConfigs.length === 0}
      >
        全选
      </Button>
      <Button onClick={handleClear} disabled={controlsDisabled || enabledIdSet.size === 0}>
        清空
      </Button>
    </div>
  )
}
