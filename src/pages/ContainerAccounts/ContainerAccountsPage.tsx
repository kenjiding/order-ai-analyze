import { BellRing, BellOff, Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { accountKindLabel } from '../../containerManagement/constants'
import type { ContainerAccount } from '../../containerManagement/types'
import { AccountFormModal } from './components/AccountFormModal'
import { useContainerAccountsPage } from './useContainerAccountsPage'

const KIND_COLOR: Record<string, string> = {
  BROKER: 'blue',
  CUSTOMER: 'gold',
  INTERNAL_WAREHOUSE: 'green',
}

export default function ContainerAccountsPage() {
  const page = useContainerAccountsPage()

  const columns: ColumnsType<ContainerAccount> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string) => <span className="font-medium text-slate-900">{value}</span>,
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 140,
      render: (value: ContainerAccount['kind']) => (
        <Tag color={KIND_COLOR[value] ?? 'default'}>{accountKindLabel[value]}</Tag>
      ),
    },
    {
      title: '绑定用户',
      dataIndex: 'boundUserIds',
      key: 'boundUserIds',
      width: 120,
      render: (ids: string[]) =>
        ids.length > 0 ? (
          <span className="tabular-nums text-slate-700">{ids.length} 人</span>
        ) : (
          <span className="text-slate-400">未绑定</span>
        ),
    },
    {
      title: '流转通知',
      dataIndex: 'pushNotify',
      key: 'pushNotify',
      width: 160,
      render: (config: ContainerAccount['pushNotify']) => {
        // 开了但没选人等于没开，这里如实显示，不让用户以为已经在推
        const live = config.enabled && config.mentions.length > 0
        return live ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700">
            <BellRing className="h-3.5 w-3.5" aria-hidden />
            <span className="tabular-nums">{config.mentions.length} 人</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-slate-400">
            <BellOff className="h-3.5 w-3.5" aria-hidden />
            {config.enabled ? '未选接收人' : '未开启'}
          </span>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, record) => (
        <div className="flex items-center gap-1">
          <Tooltip title={page.canManage ? '编辑' : '无操作权限'}>
            <Button
              type="text"
              disabled={!page.canManage}
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => page.openEdit(record)}
              aria-label="编辑"
            />
          </Tooltip>
          <Tooltip title={page.canManage ? '删除' : '无操作权限'}>
            <Button
              type="text"
              danger
              disabled={!page.canManage}
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => void page.removeAccount(record)}
              aria-label="删除"
            />
          </Tooltip>
        </div>
      ),
    },
  ]

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <Building2 className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">站点账户</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                维护容器责任站点目录并绑定可操作的用户，所有借出 / 归还都基于站点之间的账户关系记账。
              </p>
            </div>
          </div>
          {page.canManage ? (
            <Button
              type="primary"
              icon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={page.openCreate}
            >
              新增站点
            </Button>
          ) : null}
        </div>
        <div className="mt-4 inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">
          当前站点总数：{page.accounts.length}
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <Table<ContainerAccount>
          rowKey="id"
          columns={columns}
          dataSource={page.accounts}
          loading={page.loading}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          scroll={{ x: 820 }}
          locale={{ emptyText: '暂无站点账户' }}
        />
      </section>

      <AccountFormModal
        key={page.editing?.id ?? 'create'}
        open={page.formOpen}
        editing={page.editing}
        users={page.users}
        submitting={page.submitting}
        onCancel={page.closeForm}
        onSubmit={page.submitAccount}
      />
    </div>
  )
}
