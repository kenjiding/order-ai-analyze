import { History, PackageSearch, Pencil, Plus, Scale, Trash2, Warehouse } from 'lucide-react'
import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { accountKindLabel, containerTypeLabel } from '../../containerManagement/constants'
import type { ContainerBalance } from '../../containerManagement/types'
import { BalanceAuditPanel } from './components/BalanceAuditPanel'
import { BalanceDeleteModal } from './components/BalanceDeleteModal'
import { BalanceFormModal } from './components/BalanceFormModal'
import { ReconciliationPanel } from './components/ReconciliationPanel'
import { useContainerLedgerPage } from './useContainerLedgerPage'

export default function ContainerLedgerPage() {
  const page = useContainerLedgerPage()

  const columns: ColumnsType<ContainerBalance> = [
    {
      title: '站点账户',
      dataIndex: 'accountName',
      key: 'accountName',
      render: (value: string) => <span className="font-medium text-slate-900">{value}</span>,
    },
    {
      title: '站点类型',
      dataIndex: 'accountKind',
      key: 'accountKind',
      width: 130,
      render: (value: ContainerBalance['accountKind']) => (
        <span className="text-slate-600">{accountKindLabel[value]}</span>
      ),
    },
    {
      title: '品类',
      dataIndex: 'containerType',
      key: 'containerType',
      width: 120,
      render: (value: ContainerBalance['containerType']) => (
        <Tag color={value === 'BIG_BASKET' ? 'geekblue' : 'cyan'}>{containerTypeLabel[value]}</Tag>
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 110,
      align: 'right',
      // 负数只可能出现在外部方：他们作为转出方不做可用量校验，扣成负数说明有借出没进系统
      render: (value: number) =>
        value < 0 ? (
          <Tooltip title="该站点还回来的比系统记录的借出还多，说明有借出记录没进系统，请补录或盘点">
            <span className="tabular-nums font-medium text-rose-600">{value}</span>
          </Tooltip>
        ) : (
          <span className="tabular-nums font-medium">{value}</span>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <div className="flex items-center gap-1">
          <Tooltip title="编辑数量">
            <Button
              type="text"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => page.openEdit(record)}
              aria-label="编辑"
            />
          </Tooltip>
          <Tooltip title={page.canDelete ? '删除' : '无删除台账的权限'}>
            <Button
              type="text"
              danger
              disabled={!page.canDelete}
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => page.openDelete(record)}
              aria-label="删除"
            />
          </Tooltip>
        </div>
      ),
    },
  ]

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
              <h1 className="text-lg font-semibold text-slate-950">容器台账</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                按站点 × 品类维护容器库存基线，手工调账与流转确认都会留下变更记录。
              </p>
            </div>
          </div>
          {page.tab === 'balances' ? (
            <Button
              type="primary"
              icon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={page.openCreate}
            >
              新增记录
            </Button>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1">
            台账条目：{page.balances.length}
          </span>
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1">
            在库合计：{totalQuantity}
          </span>
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <PageSectionTabs
          activeId={page.tab}
          onChange={(id) => page.setTab(id as 'balances' | 'audits' | 'reconciliation')}
          items={[
            { id: 'balances', label: '容器台账', icon: PackageSearch },
            { id: 'audits', label: '变更记录', icon: History },
            { id: 'reconciliation', label: '对账', icon: Scale },
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
                showTotal: (t) => `共 ${t} 条`,
              }}
              scroll={{ x: 780 }}
              locale={{ emptyText: '暂无台账记录，请先在「站点账户」建立站点后新增。' }}
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
          ) : (
            <ReconciliationPanel accounts={page.accounts} />
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
