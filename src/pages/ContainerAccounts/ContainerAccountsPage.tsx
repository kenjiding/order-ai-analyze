import { useMemo } from 'react'
import { BellRing, BellOff, Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_KINDS, AU_REGIONS } from '../../containerManagement/constants'
import type { AccountKind, ContainerAccount } from '../../containerManagement/types'
import { AccountFormModal } from './components/AccountFormModal'
import { useContainerAccountsPage } from './useContainerAccountsPage'

const KIND_COLOR: Record<string, string> = {
  BROKER: 'blue',
  CUSTOMER: 'gold',
  CSP: 'purple',
  INTERNAL_WAREHOUSE: 'green',
}

export default function ContainerAccountsPage() {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const page = useContainerAccountsPage()

  const columns: ColumnsType<ContainerAccount> = useMemo(
    () => [
      {
        title: t('accounts.colName'),
        dataIndex: 'name',
        key: 'name',
        render: (value: string) => <span className="font-medium text-slate-900">{value}</span>,
      },
      {
        title: t('accounts.colKind'),
        dataIndex: 'kind',
        key: 'kind',
        width: 140,
        render: (value: ContainerAccount['kind']) => (
          <Tag color={KIND_COLOR[value] ?? 'default'}>{t(`accountKind.${value}`)}</Tag>
        ),
      },
      {
        title: t('accounts.colRegion'),
        dataIndex: 'regionCode',
        key: 'regionCode',
        width: 130,
        render: (value: ContainerAccount['regionCode']) =>
          value ? (
            AU_REGIONS.find((region) => region.code === value)?.name ?? value
          ) : (
            <span className="text-slate-400">{t('accounts.regionUnset')}</span>
          ),
      },
      {
        title: t('accounts.colBoundUsers'),
        key: 'boundUserIds',
        width: 130,
        render: (_: unknown, row: ContainerAccount) =>
          row.isExternal ? (
            <Tag color="orange">{t('accounts.externalParty')}</Tag>
          ) : row.boundUserIds.length > 0 ? (
            <span className="tabular-nums text-slate-700">
              {t('peopleCount', { count: row.boundUserIds.length })}
            </span>
          ) : (
            <span className="text-slate-400">{t('accounts.unbound')}</span>
          ),
      },
      {
        title: t('accounts.colPushNotify'),
        dataIndex: 'pushNotify',
        key: 'pushNotify',
        width: 160,
        render: (config: ContainerAccount['pushNotify']) => {
          const live = config.enabled && config.mentions.length > 0
          return live ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <BellRing className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular-nums">{t('peopleCount', { count: config.mentions.length })}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <BellOff className="h-3.5 w-3.5" aria-hidden />
              {config.enabled ? t('accounts.pushNoRecipients') : t('accounts.pushDisabled')}
            </span>
          )
        },
      },
      {
        title: tc('actions'),
        key: 'actions',
        width: 120,
        fixed: 'right',
        render: (_, record) => (
          <div className="flex items-center gap-1">
            <Tooltip title={page.canManage ? tc('edit') : t('accounts.noManagePermission')}>
              <Button
                type="text"
                disabled={!page.canManage}
                icon={<Pencil className="h-4 w-4" aria-hidden />}
                onClick={() => page.openEdit(record)}
                aria-label={tc('edit')}
              />
            </Tooltip>
            <Tooltip title={page.canManage ? tc('delete') : t('accounts.noManagePermission')}>
              <Button
                type="text"
                danger
                disabled={!page.canManage}
                icon={<Trash2 className="h-4 w-4" aria-hidden />}
                onClick={() => void page.removeAccount(record)}
                aria-label={tc('delete')}
              />
            </Tooltip>
          </div>
        ),
      },
    ],
    [page, t, tc],
  )

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <Building2 className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('accounts.title')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('accounts.subtitle')}</p>
            </div>
          </div>
          {page.canManage ? (
            <Button
              type="primary"
              icon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={page.openCreate}
            >
              {t('accounts.addStation')}
            </Button>
          ) : null}
        </div>
        <div className="mt-4 inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">
          {t('accounts.totalStations', { count: page.accounts.length })}
        </div>
      </header>

      <section className="admin-panel space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">{t('accounts.filterName')}</span>
            <Input
              className="w-52"
              placeholder={t('accounts.searchByName')}
              allowClear
              autoComplete="off"
              spellCheck={false}
              value={page.keyword}
              onChange={(e) => page.setKeyword(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">{t('accounts.colKind')}</span>
            <Select
              className="w-44"
              placeholder={tc('all')}
              allowClear
              value={page.kindFilter || undefined}
              onChange={(value) => page.setKindFilter((value ?? '') as AccountKind | '')}
              options={ACCOUNT_KINDS.map((kind) => ({
                value: kind,
                label: t(`accountKind.${kind}`),
              }))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">{t('accounts.filterRegion')}</span>
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
        </div>
        <Table<ContainerAccount>
          rowKey="id"
          columns={columns}
          dataSource={page.filteredAccounts}
          loading={page.loading}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => t('tableTotal', { total }),
          }}
          scroll={{ x: 820 }}
          locale={{ emptyText: t('accounts.empty') }}
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
