import { Button, Empty, Popconfirm, Table, Tabs, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Megaphone, PencilLine, Plus, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { AttendanceSchedulingPushTab } from './components/AttendanceSchedulingPushTab'
import { PushEntryEditModal } from './components/PushEntryEditModal'
import { feishuPushKindLabel, type FeishuPushEntryWithKind, type FeishuPushKind } from './feishuPushTypes'
import { postFeishuPushTest, summarizeFeishuTestFailure, type FeishuPushTestFail } from './feishuWebhookTestApi'
import { usePushNotificationsPage } from './usePushNotificationsPage'
import { showToast } from '../../utils/toast'
import type { PushEntryDraft } from './pushEntryFormTransforms'
import {
  getPushFeatureByFeishuKind,
  getPushFeatureByTabKey,
  isPushPageTabKey,
  listAccessiblePushFeatures,
  PUSH_PAGE_TAB_QUERY_KEY,
  type PushPageTabKey,
} from '../../permissions/pushNotificationAccess'

type WarehousePushTabKey = 'warehouse_efficiency' | 'attendance_scheduling' | 'order_exception'

const WAREHOUSE_PUSH_TAB_KIND: Record<WarehousePushTabKey, FeishuPushKind> = {
  warehouse_efficiency: 'sort_efficiency',
  attendance_scheduling: 'attendance_scheduling',
  order_exception: 'order_exception',
}

function truncateMiddle(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  const edge = Math.max(4, Math.floor((maxChars - 1) / 2))
  return `${s.slice(0, edge)}…${s.slice(s.length - edge)}`
}

function isWarehousePushTabKey(key: PushPageTabKey): key is WarehousePushTabKey {
  return key === 'warehouse_efficiency' || key === 'attendance_scheduling' || key === 'order_exception'
}

export default function PushNotificationsPage() {
  const { t } = useTranslation('pushNotifications')
  const v = usePushNotificationsPage()
  const { hasPermission } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const accessibleFeatures = useMemo(
    () => listAccessiblePushFeatures(hasPermission),
    [hasPermission],
  )
  const accessibleTabKeys = useMemo(
    () => accessibleFeatures.map((feature) => feature.tabKey),
    [accessibleFeatures],
  )

  const tabFromUrl = searchParams.get(PUSH_PAGE_TAB_QUERY_KEY)
  const [activeTabKey, setActiveTabKey] = useState<PushPageTabKey>(() => {
    if (tabFromUrl && isPushPageTabKey(tabFromUrl)) return tabFromUrl
    return 'warehouse_efficiency'
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<FeishuPushEntryWithKind | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const setActiveTab = useCallback(
    (tabKey: PushPageTabKey) => {
      setActiveTabKey(tabKey)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(PUSH_PAGE_TAB_QUERY_KEY, tabKey)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (!tabFromUrl || !isPushPageTabKey(tabFromUrl)) return
    if (!accessibleTabKeys.includes(tabFromUrl)) return
    setActiveTabKey(tabFromUrl)
  }, [accessibleTabKeys, tabFromUrl])

  useEffect(() => {
    if (accessibleTabKeys.length === 0) return
    if (!accessibleTabKeys.includes(activeTabKey)) {
      setActiveTab(accessibleTabKeys[0])
    }
  }, [accessibleTabKeys, activeTabKey, setActiveTab])

  const activeWarehouseTab = isWarehousePushTabKey(activeTabKey) ? activeTabKey : null
  const modalFeature = editingRecord
    ? getPushFeatureByFeishuKind(editingRecord.kind)
    : activeWarehouseTab
      ? getPushFeatureByTabKey(activeWarehouseTab)
      : null
  const modalAllowed = modalFeature ? hasPermission(modalFeature.permissionKey) : false
  const modalKind = modalFeature?.feishuKind ?? WAREHOUSE_PUSH_TAB_KIND.warehouse_efficiency
  const modalShowKindField = modalKind === 'sort_efficiency'

  const openCreateModal = useCallback(
    (tabKey: WarehousePushTabKey) => {
      const feature = getPushFeatureByTabKey(tabKey)
      if (!feature || !hasPermission(feature.permissionKey)) {
        showToast(t('toast.noPermission'), 'error')
        return
      }
      setActiveTab(tabKey)
      setEditingRecord(null)
      setModalOpen(true)
    },
    [hasPermission, setActiveTab, t],
  )

  const openEditModal = useCallback(
    (record: FeishuPushEntryWithKind) => {
      const feature = getPushFeatureByFeishuKind(record.kind)
      if (!feature || !hasPermission(feature.permissionKey)) {
        showToast(t('toast.noPermission'), 'error')
        return
      }
      if (feature.tabKey) setActiveTab(feature.tabKey)
      setEditingRecord(record)
      setModalOpen(true)
    },
    [hasPermission, setActiveTab, t],
  )

  const closeModal = () => {
    setModalOpen(false)
    setEditingRecord(null)
  }

  const handleCommitted = (entry: PushEntryDraft) => {
    const feature = getPushFeatureByFeishuKind(entry.kind)
    if (!feature || !hasPermission(feature.permissionKey)) {
      showToast(t('toast.noPermission'), 'error')
      return
    }
    const verb = editingRecord ? t('toast.verbUpdated') : t('toast.verbAdded')
    v.upsertEntry(entry, editingRecord ? editingRecord.kind : undefined)
    showToast(t('toast.entrySaved', { verb, name: entry.pushName }), 'success')
    closeModal()
  }

  const handleDelete = (record: FeishuPushEntryWithKind) => {
    const feature = getPushFeatureByFeishuKind(record.kind)
    if (!feature || !hasPermission(feature.permissionKey)) {
      showToast(t('toast.noPermission'), 'error')
      return
    }
    v.deleteEntryById(record.id)
    showToast(t('toast.entryDeleted', { name: record.pushName }), 'success')
  }

  const handlePushTest = useCallback(
    async (record: FeishuPushEntryWithKind) => {
      const feature = getPushFeatureByFeishuKind(record.kind)
      if (!feature || !hasPermission(feature.permissionKey)) {
        showToast(t('toast.noPermission'), 'error')
        return
      }
      if (record.isDisabled) {
        showToast(t('toast.entryDisabledBeforeTest', { name: record.pushName }), 'error')
        return
      }
      if (!record.webhookUrl.trim()) {
        showToast(t('toast.webhookRequiredForTest'), 'error')
        return
      }
      setTestingId(record.id)
      try {
        const res = await postFeishuPushTest({
          pushScope: feature.apiScope,
          webhookUrl: record.webhookUrl.trim(),
          signingSecret: record.signingSecret,
          pushName: record.pushName.trim() || t('common.unnamedPush'),
        })
        if (res.ok) {
          showToast(t('toast.testSent', { name: record.pushName }), 'success')
        } else if (!res.ok) {
          showToast(summarizeFeishuTestFailure(res as FeishuPushTestFail), 'error')
        }
      } finally {
        setTestingId(null)
      }
    },
    [hasPermission, t],
  )

  const buildColumns = useCallback(
    (showKindColumn: boolean, canSend: boolean): ColumnsType<FeishuPushEntryWithKind> => [
      ...(showKindColumn
        ? [
            {
              title: t('table.kind'),
              key: 'kind',
              width: 150,
              ellipsis: true,
              render: (_: unknown, row: FeishuPushEntryWithKind) => feishuPushKindLabel(row.kind),
            } satisfies ColumnsType<FeishuPushEntryWithKind>[number],
          ]
        : []),
      {
        title: t('table.pushName'),
        dataIndex: 'pushName',
        key: 'pushName',
        width: 160,
        ellipsis: true,
      },
      {
        title: t('table.pushTime'),
        dataIndex: 'pushTimeHm',
        key: 'pushTimeHm',
        width: 100,
      },
      {
        title: t('table.webhook'),
        dataIndex: 'webhookUrl',
        key: 'webhookUrl',
        render: (url: string) => (
          <Tooltip title={url}>
            <span className="block max-w-[min(520px,60vw)] font-mono text-xs text-slate-700">
              {truncateMiddle(url || '', 56)}
            </span>
          </Tooltip>
        ),
      },
      {
        title: t('table.signingSecret'),
        key: 'signingSecret',
        width: 88,
        render: (_, row) =>
          row.signingSecret ? (
            <span className="text-[var(--admin-accent)]">{t('common.configured')}</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        title: t('table.description'),
        dataIndex: 'pushDescription',
        key: 'pushDescription',
        ellipsis: true,
        render: (text: string | undefined) => (text ? text : <span className="text-slate-400">—</span>),
      },
      {
        title: t('table.status'),
        key: 'status',
        width: 88,
        render: (_, row) =>
          row.isDisabled ? (
            <span className="text-amber-600">{t('common.disabled')}</span>
          ) : (
            <span className="text-emerald-600">{t('common.enabled')}</span>
          ),
      },
      {
        title: t('table.actions'),
        key: 'actions',
        width: 290,
        fixed: 'right',
        onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
        render: (_, record) => (
          <div className="flex flex-nowrap items-center gap-0">
            <Button
              type="link"
              className="!px-1"
              onClick={() => {
                const nextDisabled = !(record.isDisabled === true)
                v.toggleEntryDisabled(record.id, nextDisabled)
                const verb = nextDisabled ? t('toast.toggleDisabled') : t('toast.toggleEnabled')
                showToast(t('toast.entryToggled', { verb, name: record.pushName }), 'success')
              }}
            >
              {record.isDisabled ? t('table.enable') : t('table.disable')}
            </Button>
            <Button
              type="link"
              className="!px-1"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={testingId === record.id}
              disabled={
                !canSend ||
                record.isDisabled === true ||
                (testingId !== null && testingId !== record.id)
              }
              onClick={() => void handlePushTest(record)}
            >
              {t('table.pushTest')}
            </Button>
            <Button
              type="link"
              className="!px-1"
              icon={<PencilLine className="h-3.5 w-3.5" />}
              onClick={() => openEditModal(record)}
            >
              {t('common.edit')}
            </Button>
            <Popconfirm
              title={t('table.deleteConfirmTitle')}
              description={t('table.deleteConfirmDesc')}
              okText={t('common.delete')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" className="!px-1" danger icon={<Trash2 className="h-3.5 w-3.5" />}>
                {t('common.delete')}
              </Button>
            </Popconfirm>
          </div>
        ),
      },
    ],
    [handleDelete, handlePushTest, openEditModal, t, testingId, v],
  )

  const renderWarehousePushTab = useCallback(
    (tabKey: WarehousePushTabKey, hint: string) => {
      const feature = getPushFeatureByTabKey(tabKey)
      const kind = WAREHOUSE_PUSH_TAB_KIND[tabKey]
      const showKindColumn = tabKey === 'warehouse_efficiency'
      const canSend = feature ? hasPermission(feature.permissionKey) : false
      const dataSource = v.entriesWithKind.filter((entry) => entry.kind === kind)

      return (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Typography.Text type="secondary" className="text-xs">
              {hint}
            </Typography.Text>
            <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openCreateModal(tabKey)}>
              {t('addPush')}
            </Button>
          </div>

          <Table<FeishuPushEntryWithKind>
            rowKey="id"
            columns={buildColumns(showKindColumn, canSend)}
            dataSource={dataSource}
            pagination={false}
            locale={{
              emptyText: <Empty className="py-12" description={t('table.empty')} />,
            }}
            scroll={{ x: showKindColumn ? 1140 : 990 }}
          />
        </div>
      )
    },
    [buildColumns, hasPermission, openCreateModal, t, v.entriesWithKind],
  )

  const tabItems = useMemo(() => {
    return accessibleFeatures.map((feature) => {
      if (feature.tabKey === 'warehouse_efficiency') {
        return {
          key: feature.tabKey,
          label: t(`tabs.${feature.tabKey}`),
          children: renderWarehousePushTab('warehouse_efficiency', t('tabHint.warehouseEfficiency')),
        }
      }
      if (feature.tabKey === 'attendance_scheduling') {
        return {
          key: feature.tabKey,
          label: t(`tabs.${feature.tabKey}`),
          children: (
            <AttendanceSchedulingPushTab
              entries={v.entriesWithKind.filter((entry) => entry.kind === 'attendance_scheduling')}
              webhookColumns={buildColumns(false, hasPermission(feature.permissionKey))}
              onOpenCreate={() => openCreateModal('attendance_scheduling')}
            />
          ),
        }
      }
      return {
        key: feature.tabKey,
        label: t(`tabs.${feature.tabKey}`),
        children: renderWarehousePushTab('order_exception', t('tabHint.orderException')),
      }
    })
  }, [accessibleFeatures, buildColumns, hasPermission, openCreateModal, renderWarehousePushTab, t, v.entriesWithKind])

  return (
    <div className="push-notifications-page admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">{t('eyebrow')}</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              {t('title')}
            </h2>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">{t('entryTotal')}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{v.storedTotalCount}</div>
          </div>
        </div>

        <div className="border-t border-[var(--admin-line)] px-5 py-4">
          {tabItems.length === 0 ? (
            <Empty
              className="py-16"
              description={t('noPermission')}
            />
          ) : (
            <Tabs activeKey={activeTabKey} onChange={(key) => setActiveTab(key as PushPageTabKey)} items={tabItems} />
          )}
        </div>
      </div>

      <PushEntryEditModal
        open={modalOpen && modalAllowed}
        editing={editingRecord}
        defaultKindForNew={modalKind}
        showKindField={modalShowKindField}
        onCancel={closeModal}
        onCommitted={handleCommitted}
      />
    </div>
  )
}
