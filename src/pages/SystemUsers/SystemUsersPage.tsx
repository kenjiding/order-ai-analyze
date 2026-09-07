import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Navigate } from 'react-router-dom'
import { Plus, Shield, UserCog, UserPlus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/authStore'
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
  const { t } = useTranslation('systemUsers')
  const { isSuperAdmin } = useAuthStore()
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
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const stats = useMemo(() => {
    const activeCount = users.filter((user) => user.isActive).length
    const adminCount = users.filter((user) => user.role === 'super_admin').length
    const inactiveCount = users.length - activeCount
    return { activeCount, adminCount, inactiveCount }
  }, [users])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(users.length / pageSize))
    if (currentPage > maxPage) {
      setCurrentPage(maxPage)
    }
  }, [users.length, pageSize, currentPage])

  const columns: ColumnsType<AdminUser> = useMemo(
    () => [
      {
        title: t('colUser'),
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
        title: t('colRegion'),
        dataIndex: 'regionName',
        key: 'regionName',
        width: 140,
        render: (name: string | null, row) => name ?? (row.role === 'super_admin' ? t('systemAdmin') : t('unassigned')),
      },
      {
        title: t('colRole'),
        dataIndex: 'role',
        key: 'role',
        width: 128,
        render: (role: AdminUser['role']) =>
          role === 'super_admin' ? (
            <Tag bordered={false} className="su-role-tag admin">
              {t('superAdmin')}
            </Tag>
          ) : (
            <Tag bordered={false} className="su-role-tag user">
              {t('regularUser')}
            </Tag>
          ),
      },
      {
        title: t('colStatus'),
        dataIndex: 'isActive',
        key: 'isActive',
        width: 96,
        render: (active: boolean) =>
          active ? (
            <span className="su-status-on">
              <span className="su-status-dot" aria-hidden />
              {t('enabled')}
            </span>
          ) : (
            <span className="text-sm text-slate-400">{t('disabled')}</span>
          ),
      },
      {
        title: t('colPermissions'),
        key: 'permissions',
        width: 120,
        render: (_, row) =>
          row.role === 'super_admin' ? (
            <span className="su-perm-pill">
              <Shield className="h-3.5 w-3.5" aria-hidden />
              {t('allPermissions')}
            </span>
          ) : (
            <Tooltip title={t('permissionCount', { count: row.permissions.length })}>
              <span className="su-perm-count">{t('permissionItems', { count: row.permissions.length })}</span>
            </Tooltip>
          ),
      },
      {
        title: t('colActions'),
        key: 'actions',
        width: 140,
        fixed: 'right',
        render: (_, row) => (
          <div className="flex items-center gap-1">
            <Button type="link" className="!px-1" onClick={() => openEdit(row)}>
              {t('edit')}
            </Button>
            {row.role !== 'super_admin' && row.isActive ? (
              <Button type="link" className="!px-1" danger onClick={() => void handleDisable(row)}>
                {t('disable')}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [handleDisable, openEdit, t],
  )

  if (!isSuperAdmin) {
    return <Navigate to="/efficiency" replace />
  }

  return (
    <div className="system-users-page admin-page">
      <header className="admin-panel su-hero mb-5 overflow-hidden">
        <div className="su-hero-head border-b border-[var(--admin-line)] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="su-page-title flex items-center gap-2.5">
                <UserCog className="h-6 w-6 shrink-0 text-[var(--admin-accent)]" aria-hidden />
                {t('title')}
              </h1>
              <p className="su-page-lead">{t('description')}</p>
            </div>
            <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={openCreate}>
              {t('createUser')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-[var(--admin-line)] sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
          <div className="su-metric">
            <div className="su-metric-label">{t('totalUsers')}</div>
            <div className="su-metric-value is-accent">
              <span className="su-metric-icon" aria-hidden>
                <Users className="h-4 w-4" />
              </span>
              {users.length}
            </div>
          </div>
          <div className="su-metric">
            <div className="su-metric-label">{t('activeUsers')}</div>
            <div className="su-metric-value">{stats.activeCount}</div>
          </div>
          <div className="su-metric">
            <div className="su-metric-label">{t('inactiveUsers')}</div>
            <div className="su-metric-value">{stats.inactiveCount}</div>
          </div>
          <div className="su-metric">
            <div className="su-metric-label">{t('superAdmins')}</div>
            <div className="su-metric-value">{stats.adminCount}</div>
          </div>
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <div className="su-table-toolbar">
          <div className="su-table-toolbar-title">
            <Users className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
            {t('accountList')}
          </div>
          <p className="su-table-toolbar-hint">
            {loading
              ? t('loadingAccounts')
              : t('accountListHint', { total: users.length, active: stats.activeCount })}
          </p>
        </div>

        <div className="su-table-wrap">
          <Table<AdminUser>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={users}
            scroll={{ x: 760 }}
            pagination={{
              current: currentPage,
              pageSize,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => t('tableTotal', { total }),
              onChange: (page, size) => {
                setCurrentPage(page)
                setPageSize(size)
              },
            }}
            locale={{
              emptyText: (
                <div className="su-empty-panel">
                  <UserPlus className="mx-auto h-8 w-8 text-[var(--admin-accent)]" aria-hidden />
                  <p>{t('emptyAccounts')}</p>
                </div>
              ),
            }}
          />
        </div>
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
