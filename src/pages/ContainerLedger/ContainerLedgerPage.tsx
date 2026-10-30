import { useCallback, useMemo, useState, type Key } from 'react'
import { Boxes, Download, History, PackageSearch, Pencil, Plus, Scale, Trash2, Warehouse } from 'lucide-react'
import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { AU_REGIONS } from '../../containerManagement/constants'
import { exportBalancesToXlsx } from './exportBalances'
import type { ContainerBalance } from '../../containerManagement/types'
import { BalanceAuditPanel } from './components/BalanceAuditPanel'
import { BalanceDeleteModal } from './components/BalanceDeleteModal'
import { BalanceFormModal } from './components/BalanceFormModal'
import { ContainerTypePanel } from './components/ContainerTypePanel'
import { ReconciliationPanel } from './components/ReconciliationPanel'
import { useContainerLedgerPage } from './useContainerLedgerPage'

/** 未分类州的分组键，不会和任何真实州代码撞车 */
const UNSET_REGION_KEY = '__unset__'

type RegionGroupRow = {
  id: string
  isGroupRow: true
  regionLabel: string
  /** 站点数按 accountId 去重——一个站点在两个品类各有一行台账，不能直接数行数 */
  stationCount: number
  /** 按品类汇总在库量，顺序沿用 page.balances 本身已排好的品类顺序 */
  typeTotals: [string, number][]
  children: ContainerBalance[]
}

/** 顶层永远是分组行，二级永远是台账行——两层级联，不会再深一层 */
type LedgerRow = ContainerBalance | RegionGroupRow

function isGroupRow(record: LedgerRow): record is RegionGroupRow {
  return 'isGroupRow' in record
}

function regionSortOrder(code: string): number {
  if (code === UNSET_REGION_KEY) return Infinity
  return AU_REGIONS.find((r) => r.code === code)?.sortOrder ?? Infinity
}

export default function ContainerLedgerPage() {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const page = useContainerLedgerPage()

  /** 按所属州分组成两层数据：顶层是州分组行（带 children），用 antd Table 原生的级联展开支持，不用再手搓合并单元格 */
  const regionGroups = useMemo<RegionGroupRow[]>(() => {
    const groups = new Map<string, ContainerBalance[]>()
    for (const row of page.balances) {
      const code = row.accountRegionCode ?? UNSET_REGION_KEY
      const list = groups.get(code)
      if (list) list.push(row)
      else groups.set(code, [row])
    }
    return [...groups.keys()]
      .sort((a, b) => regionSortOrder(a) - regionSortOrder(b))
      .map((code) => {
        const children = groups.get(code) ?? []
        const typeTotalsMap = new Map<string, number>()
        for (const row of children) {
          typeTotalsMap.set(row.containerType, (typeTotalsMap.get(row.containerType) ?? 0) + row.quantity)
        }
        return {
          id: `group:${code}`,
          isGroupRow: true as const,
          regionLabel:
            code === UNSET_REGION_KEY ? t('ledger.regionUnset') : AU_REGIONS.find((r) => r.code === code)?.name ?? code,
          stationCount: new Set(children.map((row) => row.accountId)).size,
          typeTotals: [...typeTotalsMap.entries()],
          children,
        }
      })
  }, [page.balances, t])

  /** 记录用户手动收起过的分组；没被记录的分组默认展开——这样切换州筛选后新出现的分组也是展开的 */
  const [collapsedRegionKeys, setCollapsedRegionKeys] = useState<Set<string>>(new Set())
  const expandedRowKeys = useMemo(
    () => regionGroups.map((group) => group.id).filter((id) => !collapsedRegionKeys.has(id)),
    [regionGroups, collapsedRegionKeys],
  )
  const handleExpandedRowsChange = useCallback(
    (keys: readonly Key[]) => {
      const expanded = new Set(keys.map(String))
      setCollapsedRegionKeys(new Set(regionGroups.map((group) => group.id).filter((id) => !expanded.has(id))))
    },
    [regionGroups],
  )

  const columns: ColumnsType<LedgerRow> = useMemo(
    () => [
      {
        title: t('ledger.colAccount'),
        key: 'accountName',
        render: (_, record) =>
          isGroupRow(record) ? (
            <div className="flex flex-wrap items-baseline divide-x divide-zinc-300">
              <span className="pr-2.5 font-semibold text-zinc-800">{record.regionLabel}</span>
              <span className="px-2.5 text-xs text-zinc-500">
                {t('ledger.groupStationCount', { count: record.stationCount })}
              </span>
              {record.typeTotals.map(([type, total]) => (
                <span key={type} className="px-2.5 text-xs tabular-nums text-zinc-500">
                  {t('ledger.totalInStockByType', { type: t(`containerType.${type}`), total })}
                </span>
              ))}
            </div>
          ) : (
            <span className="font-medium text-slate-900">{record.accountName}</span>
          ),
      },
      {
        title: t('ledger.colAccountKind'),
        key: 'accountKind',
        width: 130,
        render: (_, record) =>
          isGroupRow(record) ? null : (
            <span className="text-slate-600">{t(`accountKind.${record.accountKind}`)}</span>
          ),
      },
      {
        title: t('ledger.colType'),
        key: 'containerType',
        width: 120,
        render: (_, record) =>
          isGroupRow(record) ? null : (
            <Tag color={record.containerType === 'BIG_BASKET' ? 'geekblue' : 'cyan'}>
              {t(`containerType.${record.containerType}`)}
            </Tag>
          ),
      },
      {
        title: t('ledger.colQuantity'),
        key: 'quantity',
        width: 110,
        align: 'right',
        render: (_, record) => {
          if (isGroupRow(record)) return null
          return record.quantity < 0 ? (
            <Tooltip title={t('ledger.negativeTooltip')}>
              <span className="tabular-nums font-medium text-rose-600">{record.quantity}</span>
            </Tooltip>
          ) : (
            <span className="tabular-nums font-medium">{record.quantity}</span>
          )
        },
      },
      {
        title: tc('actions'),
        key: 'actions',
        width: 120,
        fixed: 'right',
        render: (_, record) => {
          if (isGroupRow(record)) return null
          return (
            <div className="flex items-center gap-1">
              <Tooltip title={page.canEdit ? t('ledger.editQuantity') : t('ledger.noEditPermission')}>
                <Button
                  type="text"
                  disabled={!page.canEdit}
                  icon={<Pencil className="h-4 w-4" aria-hidden />}
                  onClick={() => page.openEdit(record)}
                  aria-label={tc('edit')}
                />
              </Tooltip>
              <Tooltip title={page.canDelete ? tc('delete') : t('ledger.noDeletePermission')}>
                <Button
                  type="text"
                  danger
                  disabled={!page.canDelete}
                  icon={<Trash2 className="h-4 w-4" aria-hidden />}
                  onClick={() => page.openDelete(record)}
                  aria-label={tc('delete')}
                />
              </Tooltip>
            </div>
          )
        },
      },
    ],
    [page, t, tc],
  )

  /** 在库合计按品类拆开：混在一起的总数对不上任何一次实物盘点，看了也没法用 */
  const totalsByType = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of page.balances) {
      map.set(row.containerType, (map.get(row.containerType) ?? 0) + row.quantity)
    }
    return [...map.entries()]
  }, [page.balances])

  const exportBalances = useCallback(() => {
    exportBalancesToXlsx(page.balances, t)
  }, [page.balances, t])

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <Warehouse className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('ledger.title')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('ledger.subtitle')}</p>
            </div>
          </div>
          {page.tab === 'balances' ? (
            <div className="flex items-center gap-2">
              <Button
                icon={<Download className="h-4 w-4" aria-hidden />}
                disabled={!page.balances.length}
                onClick={exportBalances}
              >
                {t('ledger.exportBalances')}
              </Button>
              <Button
                type="primary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={page.openCreate}
              >
                {t('ledger.addRecord')}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1">
            {t('ledger.entryCount', { count: page.balances.length })}
          </span>
          {totalsByType.map(([type, total]) => (
            <span key={type} className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1">
              {t('ledger.totalInStockByType', { type: t(`containerType.${type}`), total })}
            </span>
          ))}
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <PageSectionTabs
          activeId={page.tab}
          onChange={(id) => page.setTab(id as 'balances' | 'audits' | 'reconciliation' | 'types')}
          items={[
            { id: 'balances', label: t('ledger.tabBalances'), icon: PackageSearch },
            { id: 'audits', label: t('ledger.tabAudits'), icon: History },
            { id: 'reconciliation', label: t('ledger.tabReconciliation'), icon: Scale },
            { id: 'types', label: t('ledger.tabTypes'), icon: Boxes },
          ]}
        />
        <div className="p-4 sm:p-5">
          {page.tab === 'balances' ? (
            <Table<LedgerRow>
              rowKey="id"
              columns={columns}
              dataSource={regionGroups}
              loading={page.loading}
              /** 按州分组展示，分页会把同一州拆到不同页，数据量小所以直接展示全部 */
              pagination={false}
              expandable={{
                expandedRowKeys,
                onExpandedRowsChange: handleExpandedRowsChange,
                expandRowByClick: true,
              }}
              rowClassName={(record) => (isGroupRow(record) ? 'bg-zinc-50 cursor-pointer' : '')}
              scroll={{ x: 780 }}
              locale={{ emptyText: t('ledger.emptyBalances') }}
            />
          ) : page.tab === 'audits' ? (
            <BalanceAuditPanel
              accounts={page.accounts}
              audits={page.audits}
              total={page.auditTotal}
              page={page.auditPage}
              pageSize={page.auditPageSize}
              loading={page.auditLoading}
              filters={page.auditFilters}
              onPageChange={page.setAuditPage}
              onApply={page.applyAuditFilters}
            />
          ) : page.tab === 'reconciliation' ? (
            <ReconciliationPanel accounts={page.accounts} />
          ) : (
            <ContainerTypePanel />
          )}
        </div>
      </section>

      <BalanceFormModal
        mode="create"
        open={page.createOpen}
        accounts={page.accounts}
        editing={null}
        submitting={page.submitting}
        onCancel={page.closeCreate}
        onCreate={page.submitCreate}
        onEdit={page.submitEdit}
      />
      <BalanceFormModal
        mode="edit"
        open={page.editing !== null}
        accounts={page.accounts}
        editing={page.editing}
        submitting={page.submitting}
        onCancel={page.closeEdit}
        onCreate={page.submitCreate}
        onEdit={page.submitEdit}
      />
      <BalanceDeleteModal
        deleting={page.deleting}
        submitting={page.submitting}
        onCancel={page.closeDelete}
        onSubmit={page.submitDelete}
      />
    </div>
  )
}
