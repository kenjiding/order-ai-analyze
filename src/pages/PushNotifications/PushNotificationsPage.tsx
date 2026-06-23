import { Button, Empty, Popconfirm, Table, Tabs, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Megaphone, PencilLine, Plus, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { AttendanceSchedulingPushTab } from './components/AttendanceSchedulingPushTab'
import { PushEntryEditModal } from './components/PushEntryEditModal'
import { FleetSupplierPushTab } from './components/FleetSupplierPushTab'
import { FEISHU_PUSH_KIND_LABELS, type FeishuPushEntryWithKind, type FeishuPushKind } from './feishuPushTypes'
import { postFeishuPushTest, summarizeFeishuTestFailure, type FeishuPushTestFail } from './feishuWebhookTestApi'
import { usePushNotificationsPage } from './usePushNotificationsPage'
import { showToast } from '../../utils/toast'
import type { PushEntryDraft } from './pushEntryFormTransforms'
import {
  getPushFeatureByFeishuKind,
  getPushFeatureByTabKey,
  listAccessiblePushFeatures,
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
  const v = usePushNotificationsPage()
  const { hasPermission } = useAuthStore()
  const accessibleFeatures = useMemo(
    () => listAccessiblePushFeatures(hasPermission),
    [hasPermission],
  )
  const accessibleTabKeys = useMemo(
    () => accessibleFeatures.map((feature) => feature.tabKey),
    [accessibleFeatures],
  )

  const [activeTabKey, setActiveTabKey] = useState<PushPageTabKey>('warehouse_efficiency')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<FeishuPushEntryWithKind | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => {
    if (accessibleTabKeys.length === 0) return
    if (!accessibleTabKeys.includes(activeTabKey)) {
      setActiveTabKey(accessibleTabKeys[0])
    }
  }, [accessibleTabKeys, activeTabKey])

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
        showToast('无操作权限', 'error')
        return
      }
      setActiveTabKey(tabKey)
      setEditingRecord(null)
      setModalOpen(true)
    },
    [hasPermission],
  )

  const openEditModal = useCallback(
    (record: FeishuPushEntryWithKind) => {
      const feature = getPushFeatureByFeishuKind(record.kind)
      if (!feature || !hasPermission(feature.permissionKey)) {
        showToast('无操作权限', 'error')
        return
      }
      if (feature.tabKey) setActiveTabKey(feature.tabKey)
      setEditingRecord(record)
      setModalOpen(true)
    },
    [hasPermission],
  )

  const closeModal = () => {
    setModalOpen(false)
    setEditingRecord(null)
  }

  const handleCommitted = (entry: PushEntryDraft) => {
    const feature = getPushFeatureByFeishuKind(entry.kind)
    if (!feature || !hasPermission(feature.permissionKey)) {
      showToast('无操作权限', 'error')
      return
    }
    const verb = editingRecord ? '更新' : '添加'
    v.upsertEntry(entry, editingRecord ? editingRecord.kind : undefined)
    showToast(`已${verb}「${entry.pushName}」并写入本地。`, 'success')
    closeModal()
  }

  const handleDelete = (record: FeishuPushEntryWithKind) => {
    const feature = getPushFeatureByFeishuKind(record.kind)
    if (!feature || !hasPermission(feature.permissionKey)) {
      showToast('无操作权限', 'error')
      return
    }
    v.deleteEntryById(record.id)
    showToast(`已删除「${record.pushName}」。`, 'success')
  }

  const handlePushTest = useCallback(
    async (record: FeishuPushEntryWithKind) => {
      const feature = getPushFeatureByFeishuKind(record.kind)
      if (!feature || !hasPermission(feature.permissionKey)) {
        showToast('无操作权限', 'error')
        return
      }
      if (record.isDisabled) {
        showToast(`「${record.pushName}」已禁用，请先启用后再测试。`, 'error')
        return
      }
      if (!record.webhookUrl.trim()) {
        showToast('请先填写有效的群 webhook 地址后再测试。', 'error')
        return
      }
      setTestingId(record.id)
      try {
        const res = await postFeishuPushTest({
          pushScope: feature.apiScope,
          webhookUrl: record.webhookUrl.trim(),
          signingSecret: record.signingSecret,
          pushName: record.pushName.trim() || '未命名推送',
        })
        if (res.ok) {
          showToast(`「${record.pushName}」测试消息已发送至飞书，请到群内确认是否收到。`, 'success')
        } else if (!res.ok) {
          showToast(summarizeFeishuTestFailure(res as FeishuPushTestFail), 'error')
        }
      } finally {
        setTestingId(null)
      }
    },
    [hasPermission],
  )

  const buildColumns = useCallback(
    (showKindColumn: boolean, canSend: boolean): ColumnsType<FeishuPushEntryWithKind> => [
      ...(showKindColumn
        ? [
            {
              title: '推送类型',
              key: 'kind',
              width: 150,
              ellipsis: true,
              render: (_: unknown, row: FeishuPushEntryWithKind) => FEISHU_PUSH_KIND_LABELS[row.kind],
            } satisfies ColumnsType<FeishuPushEntryWithKind>[number],
          ]
        : []),
      {
        title: '推送名称',
        dataIndex: 'pushName',
        key: 'pushName',
        width: 160,
        ellipsis: true,
      },
      {
        title: '推送时间',
        dataIndex: 'pushTimeHm',
        key: 'pushTimeHm',
        width: 100,
      },
      {
        title: '群 webhook',
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
        title: '密钥',
        key: 'signingSecret',
        width: 88,
        render: (_, row) =>
          row.signingSecret ? (
            <span className="text-[var(--admin-accent)]">已配置</span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        title: '推送描述',
        dataIndex: 'pushDescription',
        key: 'pushDescription',
        ellipsis: true,
        render: (text: string | undefined) => (text ? text : <span className="text-slate-400">—</span>),
      },
      {
        title: '状态',
        key: 'status',
        width: 88,
        render: (_, row) =>
          row.isDisabled ? (
            <span className="text-amber-600">已禁用</span>
          ) : (
            <span className="text-emerald-600">已启用</span>
          ),
      },
      {
        title: '操作',
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
                showToast(`已${nextDisabled ? '禁用' : '启用'}「${record.pushName}」。`, 'success')
              }}
            >
              {record.isDisabled ? '启用' : '禁用'}
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
              推送测试
            </Button>
            <Button
              type="link"
              className="!px-1"
              icon={<PencilLine className="h-3.5 w-3.5" />}
              onClick={() => openEditModal(record)}
            >
              编辑
            </Button>
            <Popconfirm
              title="确认删除这条推送配置？"
              description="将从本机移除并不可恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" className="!px-1" danger icon={<Trash2 className="h-3.5 w-3.5" />}>
                删除
              </Button>
            </Popconfirm>
          </div>
        ),
      },
    ],
    [handleDelete, handlePushTest, openEditModal, testingId, v],
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
              添加推送
            </Button>
          </div>

          <Table<FeishuPushEntryWithKind>
            rowKey="id"
            columns={buildColumns(showKindColumn, canSend)}
            dataSource={dataSource}
            pagination={false}
            locale={{
              emptyText: <Empty className="py-12" description="暂无推送条目，点击右上角「添加推送」开始配置。" />,
            }}
            scroll={{ x: showKindColumn ? 1140 : 990 }}
          />
        </div>
      )
    },
    [buildColumns, hasPermission, openCreateModal, v.entriesWithKind],
  )

  const tabItems = useMemo(() => {
    return accessibleFeatures.map((feature) => {
      if (feature.tabKey === 'warehouse_efficiency') {
        return {
          key: feature.tabKey,
          label: feature.label,
          children: renderWarehousePushTab(
            'warehouse_efficiency',
            '管理仓库效率相关推送；列表与编辑弹窗中可维护推送类型。',
          ),
        }
      }
      if (feature.tabKey === 'attendance_scheduling') {
        return {
          key: feature.tabKey,
          label: feature.label,
          children: (
            <AttendanceSchedulingPushTab
              entries={v.entriesWithKind.filter((entry) => entry.kind === 'attendance_scheduling')}
              webhookColumns={buildColumns(false, hasPermission(feature.permissionKey))}
              onOpenCreate={() => openCreateModal('attendance_scheduling')}
            />
          ),
        }
      }
      if (feature.tabKey === 'order_exception') {
        return {
          key: feature.tabKey,
          label: feature.label,
          children: renderWarehousePushTab(
            'order_exception',
            '配置订单异常分析结果推送目标；在「AI订单异常管理」完成分析后，可一键推送 AI 总结卡片到此处配置的飞书群。',
          ),
        }
      }
      return {
        key: feature.tabKey,
        label: feature.label,
        children: <FleetSupplierPushTab />,
      }
    })
  }, [accessibleFeatures, buildColumns, hasPermission, openCreateModal, renderWarehousePushTab, v.entriesWithKind])

  return (
    <div className="push-notifications-page admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Messaging</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              飞书推送
            </h2>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">推送条目总数</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{v.storedTotalCount}</div>
          </div>
        </div>

        <div className="border-t border-[var(--admin-line)] px-5 py-4">
          {tabItems.length === 0 ? (
            <Empty
              className="py-16"
              description="当前账号未分配任何推送子功能权限，请联系管理员在「按钮权限」中勾选对应推送类型。"
            />
          ) : (
            <Tabs activeKey={activeTabKey} onChange={(key) => setActiveTabKey(key as PushPageTabKey)} items={tabItems} />
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
