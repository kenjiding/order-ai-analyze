import { Button, Checkbox, Tooltip } from 'antd'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { isSupplierPushEligible } from '../selection'
import type { SupplierPushConfig } from '../types'

type Props = {
  configs: SupplierPushConfig[]
  enabledIdSet: ReadonlySet<string>
  onToggle: (configId: string, next: boolean) => void
  disabled?: boolean
  togglingId?: string | null
  saving?: boolean
  emptyText?: ReactNode
  columns?: 4 | 5
  requirePushable?: boolean
}

const COLUMNS_CLASS: Record<4 | 5, string> = {
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
}

export function SupplierPushSelectionGrid({
  configs,
  enabledIdSet,
  onToggle,
  disabled = false,
  togglingId = null,
  saving = false,
  emptyText,
  columns = 4,
  requirePushable = true,
}: Props) {
  const { t } = useTranslation('common')
  const resolvedEmpty = emptyText ?? t('supplierConfigEmpty')
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
    return <p className="text-xs text-slate-400">{resolvedEmpty}</p>
  }

  return (
    <div className={`grid grid-cols-2 gap-2 ${COLUMNS_CLASS[columns]}`}>
      {configs.map((c) => {
        const checked = enabledIdSet.has(c.id)
        const eligible = !requirePushable || isSupplierPushEligible(c)
        const busy = saving && togglingId !== c.id
        const itemDisabled = disabled || !eligible || busy
        const nickname = c.supplierNickname?.trim()
        const primary = nickname || c.vendorName || t('unknownSupplier')
        const showVendorLine = !!nickname && c.vendorName.trim().length > 0
        const isDuplicateVendor = duplicateVendorCodeSet.has(c.vendorCode.trim())
        const routeCode = c.routeCode.trim()
        const stationCode = c.stationCode?.trim() ?? ''
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
                    {t('stationCode', { code: stationCode })}
                  </span>
                </Tooltip>
              )}
              {showRouteLine && (
                <Tooltip title={routeCode}>
                  <span className={`truncate text-[10px] ${eligible ? 'text-slate-500' : 'text-slate-400'}`}>
                    {t('routeCode', { code: routeCode })}
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
              <Tooltip title={t('noWebhookChatPush')}>
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
  requirePushable?: boolean
  onBulkChange?: (ids: string[]) => void
}

export function SupplierPushSelectAllButtons({
  configs,
  enabledIdSet,
  onToggle,
  disabled = false,
  saving = false,
  requirePushable = true,
  onBulkChange,
}: SelectAllButtonsProps) {
  const { t } = useTranslation('common')
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
        {t('selectAll')}
      </Button>
      <Button onClick={handleClear} disabled={controlsDisabled || enabledIdSet.size === 0}>
        {t('clearAll')}
      </Button>
    </div>
  )
}
