import { Button, Empty, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ExternalLink } from 'lucide-react'
import { useMemo, type Key, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH,
} from '../constants'
import { buildSupplierPushCatalogColumns } from './supplierPushTableColumns'
import { buildScopeStatusAndActionsColumns } from './scopeEnableColumn'
import type { SupplierConfigScopeKey, SupplierPushConfig } from '../types'

export type SupplierPushConfigPanelScopeBinding = {
  scopeKey: SupplierConfigScopeKey
  enabledIds: string[]
  onToggle: (configId: string, enabled: boolean) => unknown
  togglingId?: string | null
  saving?: boolean
  toggleColumnLabel?: string
}

export type SupplierPushConfigPanelSelection = {
  selectedRowKeys: Key[]
  onSelectedRowKeysChange: (keys: Key[]) => void
}

type Props = {
  configs: SupplierPushConfig[]
  loading?: boolean
  title?: string
  description?: string
  scopeBinding?: SupplierPushConfigPanelScopeBinding
  /** @deprecated 供应商配置表请用 scope 启用/禁用；多选仅用于「立即推送」等独立面板 */
  selection?: SupplierPushConfigPanelSelection
  extraColumns?: ColumnsType<SupplierPushConfig>
  headerExtra?: ReactNode
  scrollX?: number
  /** 嵌入外层已有 panel 时仅渲染表格，不重复标题与维护入口 */
  embedded?: boolean
}

export function SupplierPushConfigPanel({
  configs,
  loading = false,
  title = '供应商配置',
  description,
  scopeBinding,
  selection,
  extraColumns = [],
  headerExtra,
  scrollX = 960,
  embedded = false,
}: Props) {
  const columns = useMemo(() => {
    const base = buildSupplierPushCatalogColumns()
    const scopeCols = scopeBinding ? buildScopeStatusAndActionsColumns(scopeBinding) : []
    return [...base, ...extraColumns, ...scopeCols]
  }, [extraColumns, scopeBinding])

  const statsLine = useMemo(() => {
    const parts: string[] = []
    if (scopeBinding) parts.push(`已启用 ${scopeBinding.enabledIds.length}`)
    if (selection) parts.push(`已选 ${selection.selectedRowKeys.length}`)
    return parts.join(' · ')
  }, [scopeBinding, selection])

  const table = (
    <Table<SupplierPushConfig>
      rowKey="id"
      columns={columns}
      dataSource={configs}
      loading={loading}
      pagination={false}
      scroll={{ x: scrollX }}
      rowSelection={
        selection
          ? {
              selectedRowKeys: selection.selectedRowKeys,
              onChange: selection.onSelectedRowKeysChange,
              columnWidth: 44,
            }
          : undefined
      }
      locale={{
        emptyText: (
          <Empty
            className="py-10"
            description={
              <Typography.Text type="secondary">
                暂无供应商配置，请前往「飞书推送 → 车队供应商推送」添加。
              </Typography.Text>
            }
          />
        ),
      }}
    />
  )

  if (embedded) {
    return table
  }

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
        <div>
          <div className="admin-eyebrow">Push Configs</div>
          <h3 className="admin-title mt-0.5 text-base">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {description ??
              '在「飞书推送 → 车队供应商推送」统一维护 Webhook 与路由码；本页「启用/禁用」仅作用于当前业务。'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {statsLine ? (
            <span className="text-xs tabular-nums text-slate-500">{statsLine}</span>
          ) : null}
          {headerExtra}
          <Link to={SUPPLIER_PUSH_CONFIG_MAINTAIN_PATH}>
            <Button icon={<ExternalLink className="h-4 w-4" />}>前往维护配置</Button>
          </Link>
        </div>
      </div>

      <div className="px-5 py-4">{table}</div>
    </div>
  )
}
