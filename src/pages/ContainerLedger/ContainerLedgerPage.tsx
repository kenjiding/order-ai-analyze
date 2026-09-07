import { useMemo } from 'react'
import { Boxes, History, PackageSearch, Pencil, Plus, Scale, Trash2, Warehouse } from 'lucide-react'
import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../components/PageSectionTabs'
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

  const columns: ColumnsType<ContainerBalance> = useMemo(
    () => [
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
            <Tooltip title={t('ledger.editQuantity')}>
              <Button
                type="text"
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
    [page, t, tc],
  )

  const totalQuantity = page.balances.reduce((sum, row) => sum + row.quantity, 0)

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
            <Button
              type="primary"
              icon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={page.openCreate}
            >
              {t('ledger.addRecord')}
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1">
            {t('ledger.entryCount', { count: page.balances.length })}
          </span>
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1">
            {t('ledger.totalInStock', { total: totalQuantity })}
          </span>
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
            <Table<ContainerBalance>
              rowKey="id"
              columns={columns}
              dataSource={page.balances}
              loading={page.loading}
              pagination={{
                pageSize: 10,
                showSizeChanger: false,
                showTotal: (total) => t('tableTotal', { total }),
              }}
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
