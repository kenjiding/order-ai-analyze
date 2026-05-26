import { Button, Empty, Popconfirm, Table, Tabs, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Megaphone, PencilLine, Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PushEntryEditModal } from './components/PushEntryEditModal'
import { FleetSupplierPushTab } from './components/FleetSupplierPushTab'
import { FEISHU_PUSH_KIND_LABELS, type FeishuPushEntryWithKind } from './feishuPushTypes'
import { postFeishuPushTest, summarizeFeishuTestFailure, type FeishuPushTestFail } from './feishuWebhookTestApi'
import { usePushNotificationsPage } from './usePushNotificationsPage'
import { showToast } from '../../utils/toast'
import type { PushEntryDraft } from './pushEntryFormTransforms'

function truncateMiddle(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s
  const edge = Math.max(4, Math.floor((maxChars - 1) / 2))
  return `${s.slice(0, edge)}…${s.slice(s.length - edge)}`
}

export default function PushNotificationsPage() {
  const v = usePushNotificationsPage()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<FeishuPushEntryWithKind | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const openCreateModal = () => {
    setEditingRecord(null)
    setModalOpen(true)
  }

  const openEditModal = (record: FeishuPushEntryWithKind) => {
    setEditingRecord(record)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingRecord(null)
  }

  const handleCommitted = (entry: PushEntryDraft) => {
    const verb = editingRecord ? '更新' : '添加'
    v.upsertEntry(entry, editingRecord ? editingRecord.kind : undefined)
    showToast(`已${verb}「${entry.pushName}」并写入本地。`, 'success')
    closeModal()
  }

  const handleDelete = (record: FeishuPushEntryWithKind) => {
    v.deleteEntryById(record.id)
    showToast(`已删除「${record.pushName}」。`, 'success')
  }

  const handlePushTest = async (record: FeishuPushEntryWithKind) => {
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
        webhookUrl: record.webhookUrl.trim(),
        signingSecret: record.signingSecret,
        pushName: record.pushName.trim() || '未命名推送',
      })
      if (res.ok) {
        showToast(
          `「${record.pushName}」测试消息已发送至飞书，请到群内确认是否收到。`,
          'success'
        )
      } else if (!res.ok) {
        showToast(summarizeFeishuTestFailure(res as FeishuPushTestFail), 'error')
      }
    } finally {
      setTestingId(null)
    }
  }

  const columns: ColumnsType<FeishuPushEntryWithKind> = [
    {
      title: '推送类型',
      key: 'kind',
      width: 150,
      ellipsis: true,
      render: (_, row) => FEISHU_PUSH_KIND_LABELS[row.kind],
    },
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
        row.signingSecret ? <span className="text-[var(--admin-accent)]">已配置</span> : <span className="text-slate-400">—</span>,
    },
    {
      title: '推送描述',
      dataIndex: 'pushDescription',
      key: 'pushDescription',
      ellipsis: true,
      render: (text: string | undefined) =>
        text ? (
          text
        ) : (
          <span className="text-slate-400">—</span>
        ),
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
            size="small"
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
            size="small"
            className="!px-1"
            icon={<Send className="h-3.5 w-3.5" />}
            loading={testingId === record.id}
            disabled={record.isDisabled === true || (testingId !== null && testingId !== record.id)}
            onClick={() => void handlePushTest(record)}
          >
            推送测试
          </Button>
          <Button
            type="link"
            size="small"
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
            <Button type="link" size="small" className="!px-1" danger icon={<Trash2 className="h-3.5 w-3.5" />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

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
          <Tabs
            defaultActiveKey="warehouse_efficiency"
            items={[
              {
                key: 'warehouse_efficiency',
                label: '仓库效率推送',
                children: (
                  <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <Typography.Text type="secondary" className="text-xs">
                        以下为全部推送条目（类型在列表与编辑弹窗中维护）。
                      </Typography.Text>
                      <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={openCreateModal}>
                        添加推送
                      </Button>
                    </div>

                    <Table<FeishuPushEntryWithKind>
                      rowKey="id"
                      columns={columns}
                      dataSource={v.entriesWithKind}
                      pagination={false}
                      size="middle"
                      locale={{
                        emptyText: (
                          <Empty className="py-12" description="暂无推送条目，点击右上角「添加推送」开始配置。" />
                        ),
                      }}
                      scroll={{ x: 1140 }}
                    />
                  </div>
                ),
              },
              {
                key: 'fleet_supplier',
                label: '车队供应商推送',
                children: <FleetSupplierPushTab />,
              },
            ]}
          />
        </div>
      </div>

      <PushEntryEditModal
        open={modalOpen}
        editing={editingRecord}
        onCancel={closeModal}
        onCommitted={handleCommitted}
      />
    </div>
  )
}
