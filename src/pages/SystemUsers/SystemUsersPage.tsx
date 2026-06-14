import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Navigate } from 'react-router-dom'
import { Plus, Shield, UserCog, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import type { AdminUser } from '../../api/adminUsersApi'
import UserFormModal from './components/UserFormModal'
import { useSystemUsersPage } from './useSystemUsersPage'

function StatChip({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number | string
  tone?: 'default' | 'accent'
}) {
  return (
    <div
      className={[
        'rounded-lg px-3 py-2 ring-1',
        tone === 'accent'
          ? 'bg-[var(--admin-accent-soft)] text-[#1f6f68] ring-[rgba(47,143,135,0.18)]'
          : 'bg-white text-slate-700 ring-slate-200',
      ].join(' ')}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default function SystemUsersPage() {
  const { isSuperAdmin } = useAuth()
  const {
    users,
    regions,
    menuPermissions,
    buttonPermissions,
    loading,
    modalOpen,
    editingUser,
    saving,
    openCreate,
    openEdit,
    closeModal,
    handleSubmit,
    handleDisable,
  } = useSystemUsersPage()

  const stats = useMemo(() => {
    const activeCount = users.filter((user) => user.isActive).length
    const adminCount = users.filter((user) => user.role === 'super_admin').length
    return { activeCount, adminCount }
  }, [users])

  if (!isSuperAdmin) {
    return <Navigate to="/efficiency" replace />
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: '用户',
      key: 'username',
      ellipsis: true,
      render: (_, row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{row.username}</div>
          {row.displayName ? <div className="truncate text-xs text-slate-500">{row.displayName}</div> : null}
        </div>
      ),
    },
    {
      title: '州/区域',
      dataIndex: 'regionName',
      key: 'regionName',
      width: 140,
      render: (name: string | null, row) => name ?? (row.role === 'super_admin' ? '系统管理' : '—'),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role: AdminUser['role']) =>
        role === 'super_admin' ? (
          <Tag bordered={false} className="mr-0 bg-emerald-50 text-emerald-700">
            超级管理员
          </Tag>
        ) : (
          <Tag bordered={false} className="mr-0 bg-slate-100 text-slate-700">
            普通用户
          </Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 96,
      render: (active: boolean) =>
        active ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f8f87]" />
            启用
          </span>
        ) : (
          <span className="text-sm text-slate-400">禁用</span>
        ),
    },
    {
      title: '权限',
      key: 'permissions',
      width: 120,
      render: (_, row) =>
        row.role === 'super_admin' ? (
          <span className="inline-flex items-center gap-1 text-sm text-[#1f6f68]">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            全部
          </span>
        ) : (
          <Tooltip title={`${row.permissions.length} 项已分配`}>
            <span className="text-sm tabular-nums text-slate-700">{row.permissions.length} 项</span>
          </Tooltip>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <Button type="link" className="!px-1" onClick={() => openEdit(row)}>
            编辑
          </Button>
          {row.role !== 'super_admin' && row.isActive ? (
            <Button type="link" className="!px-1" danger onClick={() => void handleDisable(row)}>
              禁用
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <main className="admin-page mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">System Access</div>
          <h1 className="mt-1 flex items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-950">
            <UserCog className="h-6 w-6 text-[var(--admin-accent)]" aria-hidden />
            用户管理
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">维护后台账号与权限，不支持用户自助注册。</p>
        </div>
        <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
          新建用户
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:max-w-xl">
        <StatChip label="总用户" value={users.length} tone="accent" />
        <StatChip label="启用中" value={stats.activeCount} />
        <StatChip label="超级管理员" value={stats.adminCount} />
      </div>

      <div className="admin-panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-xs text-slate-500">
          <Users className="h-3.5 w-3.5" aria-hidden />
          账号列表
        </div>
        <Table<AdminUser>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users}
          scroll={{ x: 720 }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
        />
      </div>

      <UserFormModal
        open={modalOpen}
        saving={saving}
        editingUser={editingUser}
        regions={regions}
        menuPermissions={menuPermissions}
        buttonPermissions={buttonPermissions}
        onCancel={closeModal}
        onSubmit={handleSubmit}
      />
    </main>
  )
}
