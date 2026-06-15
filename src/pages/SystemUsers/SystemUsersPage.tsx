import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Navigate } from 'react-router-dom'
import { Plus, Shield, UserCog, UserPlus, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '../../context/AuthContext'
import type { AdminUser } from '../../api/adminUsersApi'
import UserFormModal from './components/UserFormModal'
import { useSystemUsersPage } from './useSystemUsersPage'
import './systemUsers.css'

function userInitial(username: string): string {
  const trimmed = username.trim()
  if (!trimmed) return '?'
  return trimmed.slice(0, 1).toUpperCase()
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
    const inactiveCount = users.length - activeCount
    return { activeCount, adminCount, inactiveCount }
  }, [users])

  if (!isSuperAdmin) {
    return <Navigate to="/efficiency" replace />
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: '用户',
      key: 'username',
      ellipsis: true,
      render: (_, row) => {
        const isAdmin = row.role === 'super_admin'
        return (
          <div className="su-user-cell">
            <span className={['su-user-avatar', isAdmin ? 'is-admin' : ''].filter(Boolean).join(' ')}>
              {userInitial(row.username)}
            </span>
            <div className="min-w-0">
              <div className="su-user-name truncate">{row.username}</div>
              {row.displayName ? <div className="su-user-display">{row.displayName}</div> : null}
            </div>
          </div>
        )
      },
    },
    {
      title: '州/区域',
      dataIndex: 'regionName',
      key: 'regionName',
      width: 140,
      render: (name: string | null, row) => name ?? (row.role === 'super_admin' ? '系统管理' : '未分配'),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 128,
      render: (role: AdminUser['role']) =>
        role === 'super_admin' ? (
          <Tag bordered={false} className="su-role-tag admin">
            超级管理员
          </Tag>
        ) : (
          <Tag bordered={false} className="su-role-tag user">
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
          <span className="su-status-on">
            <span className="su-status-dot" aria-hidden />
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
          <span className="su-perm-pill">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            全部
          </span>
        ) : (
          <Tooltip title={`已分配 ${row.permissions.length} 项权限`}>
            <span className="su-perm-count">{row.permissions.length} 项</span>
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
    <div className="system-users-page admin-page">
      <header className="admin-panel su-hero mb-5 overflow-hidden">
        <div className="su-hero-head border-b border-[var(--admin-line)] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="su-page-title flex items-center gap-2.5">
                <UserCog className="h-6 w-6 shrink-0 text-[var(--admin-accent)]" aria-hidden />
                用户管理
              </h1>
              <p className="su-page-lead">
                维护后台账号、区域归属与菜单/按钮权限。账号由管理员创建，不支持自助注册。
              </p>
            </div>
            <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={openCreate}>
              新建用户
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-[var(--admin-line)] sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <div className="su-metric">
            <div className="su-metric-label">总用户</div>
            <div className="su-metric-value is-accent">
              <span className="su-metric-icon" aria-hidden>
                <Users className="h-4 w-4" />
              </span>
              {users.length}
            </div>
          </div>
          <div className="su-metric">
            <div className="su-metric-label">启用中</div>
            <div className="su-metric-value">{stats.activeCount}</div>
          </div>
          <div className="su-metric">
            <div className="su-metric-label">已禁用</div>
            <div className="su-metric-value">{stats.inactiveCount}</div>
          </div>
          <div className="su-metric">
            <div className="su-metric-label">超级管理员</div>
            <div className="su-metric-value">{stats.adminCount}</div>
          </div>
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <div className="su-table-toolbar">
          <div className="su-table-toolbar-title">
            <Users className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            账号列表
          </div>
          <p className="su-table-toolbar-hint">
            {loading ? '正在加载…' : `共 ${users.length} 个账号，${stats.activeCount} 个处于启用状态`}
          </p>
        </div>

        <Table<AdminUser>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={users}
          scroll={{ x: 760 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{
            emptyText: (
              <div className="su-empty-panel">
                <UserPlus className="mx-auto h-8 w-8 text-[var(--admin-accent)]" aria-hidden />
                <p>暂无后台账号。点击右上角「新建用户」创建第一个账号。</p>
              </div>
            ),
          }}
        />
      </section>

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
    </div>
  )
}
