import { useCallback, useMemo } from 'react'
import { Boxes, Download, History, PackageSearch, Pencil, Plus, Scale, Trash2, Warehouse } from 'lucide-react'
import { Button, Select, Table, Tag, Tooltip } from 'antd'
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

export default function ContainerLedgerPage() {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const page = useContainerLedgerPage()

  /** 按所属州排序+分组：先按州（未分类排最后）、再按站点名排序，同州行用 rowSpan 合并首列，省去折叠/切换 */
  const groupedBalances = useMemo(() => {
    const filtered = page.regionFilter
      ? page.balances.filter((row) => row.accountRegionCode === page.regionFilter)
      : page.balances
    const sorted = [...filtered].sort((a, b) => {
      const oa = AU_REGIONS.find((r) => r.code === a.accountRegionCode)?.sortOrder ?? Infinity
      const ob = AU_REGIONS.find((r) => r.code === b.accountRegionCode)?.sortOrder ?? Infinity
      if (oa !== ob) return oa - ob
      return a.accountName.localeCompare(b.accountName, 'zh-CN')
    })
    const rowSpans: number[] = []
    let i = 0
    while (i < sorted.length) {
      let j = i + 1
      while (j < sorted.length && sorted[j].accountRegionCode === sorted[i].accountRegionCode) j++
      rowSpans[i] = j - i
      for (let k = i + 1; k < j; k++) rowSpans[k] = 0
      i = j
    }
    return sorted.map((row, index) => ({ row, rowSpan: rowSpans[index] }))
  }, [page.balances, page.regionFilter])

  const columns: ColumnsType<ContainerBalance> = useMemo(
    () => [
      {
        title: t('ledger.colRegion'),
        dataIndex: 'accountRegionCode',
        key: 'accountRegionCode',
        width: 120,
        render: (value: ContainerBalance['accountRegionCode']) =>
          value ? (
            AU_REGIONS.find((region) => region.code === value)?.name ?? value
          ) : (
            <span className="text-slate-400">{t('ledger.regionUnset')}</span>
          ),
        onCell: (_: ContainerBalance, index?: number) => ({
          rowSpan: index === undefined ? 1 : groupedBalances[index]?.rowSpan ?? 1,
        }),
      },
      {
        title: t('ledger.colAccount'),
        dataIndex: 'accountName',
        key: 'accountName',
        render: (value: string) => <span className="font-medium text-slate-900">{value}</span>,
      },
      {
        title: t('ledger.colAccountKind'),
        dataIndex: 'accountKind',
        key: 'accountKind',
        width: 130,
        render: (value: ContainerBalance['accountKind']) => (
          <span className="text-slate-600">{t(`accountKind.${value}`)}</span>
        ),
      },
      {
        title: t('ledger.colType'),
        dataIndex: 'containerType',
        key: 'containerType',
        width: 120,
        render: (value: ContainerBalance['containerType']) => (
          <Tag color={value === 'BIG_BASKET' ? 'geekblue' : 'cyan'}>{t(`containerType.${value}`)}</Tag>
        ),
      },
      {
        title: t('ledger.colQuantity'),
        dataIndex: 'quantity',
        key: 'quantity',
        width: 110,
        align: 'right',
        render: (value: number) =>
          value < 0 ? (
            <Tooltip title={t('ledger.negativeTooltip')}>
              <span className="tabular-nums font-medium text-rose-600">{value}</span>
            </Tooltip>
          ) : (
            <span className="tabular-nums font-medium">{value}</span>
          ),
      },
      {
        title: tc('actions'),
        key: 'actions',
        width: 120,
        fixed: 'right',
        render: (_, record) => (
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
        ),
      },
    ],
    [page, t, tc, groupedBalances],
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
            <div className="space-y-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-slate-500">{t('ledger.filterRegion')}</span>
                <Select
                  className="w-44"
                  placeholder={tc('all')}
                  allowClear
                  value={page.regionFilter || undefined}
                  onChange={(value) => page.setRegionFilter(value ?? '')}
                  options={AU_REGIONS.map((region) => ({
                    value: region.code,
                    label: region.name,
                  }))}
                />
              </label>
              <Table<ContainerBalance>
                rowKey="id"
                columns={columns}
                dataSource={groupedBalances.map((group) => group.row)}
                loading={page.loading}
                /** 按州合并了行，分页会把同一州拆到不同页、合并单元格就错位，数据量小所以直接展示全部 */
                pagination={false}
                scroll={{ x: 780 }}
                locale={{ emptyText: t('ledger.emptyBalances') }}
              />
            </div>
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
