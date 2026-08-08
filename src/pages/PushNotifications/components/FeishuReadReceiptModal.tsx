import { Button, Empty, List, Modal, Progress, Spin, Tag, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import {
  fetchFeishuPushMessageReadStatus,
  fetchFeishuPushMessages,
  type FeishuPushMessageRecord,
  type FeishuReadStatus,
} from '../feishuWebhookTestApi'
import { showToast } from '../../../utils/toast'

type Props = {
  open: boolean
  supplierId: string | null
  supplierLabel: string
  onClose: () => void
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const MSG_TYPE_LABEL: Record<string, string> = {
  interactive: '富文本卡片',
  text: '文案',
  image: '图片',
}

export function FeishuReadReceiptModal({ open, supplierId, supplierLabel, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState<FeishuPushMessageRecord[]>([])
  const [statusById, setStatusById] = useState<Record<string, FeishuReadStatus | 'loading' | 'error'>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !supplierId) return
    setLoading(true)
    setStatusById({})
    setExpandedId(null)
    void (async () => {
      const res = await fetchFeishuPushMessages(supplierId)
      setLoading(false)
      if (!res.ok) {
        showToast(`获取推送记录失败：${res.error}`, 'error')
        setRecords([])
        return
      }
      setRecords(res.data)
    })()
  }, [open, supplierId])

  const toggleExpand = async (record: FeishuPushMessageRecord) => {
    if (expandedId === record.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(record.id)
    if (statusById[record.id] && statusById[record.id] !== 'error') return
    setStatusById((prev) => ({ ...prev, [record.id]: 'loading' }))
    const res = await fetchFeishuPushMessageReadStatus(record.id)
    if (!res.ok) {
      setStatusById((prev) => ({ ...prev, [record.id]: 'error' }))
      showToast(`查询已读状态失败：${res.error}`, 'error')
      return
    }
    setStatusById((prev) => ({ ...prev, [record.id]: res.data }))
  }

  return (
    <Modal open={open} title={`「${supplierLabel}」已读情况`} onCancel={onClose} footer={null} width={560} destroyOnHidden>
      {loading ? (
        <div className="flex justify-center py-8">
          <Spin />
        </div>
      ) : records.length === 0 ? (
        <Empty description="暂无通过应用机器人发送的推送记录（仅记录配置了 chat_id 后发出的消息，且仅 7 天内可查已读）" />
      ) : (
        <List
          dataSource={records}
          renderItem={(record) => {
            const status = statusById[record.id]
            const expanded = expandedId === record.id
            return (
              <List.Item key={record.id} className="!block">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700">
                      {MSG_TYPE_LABEL[record.msgType] ?? record.msgType}
                      {record.pushLabel ? ` · ${record.pushLabel}` : ''}
                    </div>
                    <div className="text-xs text-slate-400">{formatDateTime(record.createdAt)}</div>
                  </div>
                  <Button type="link" onClick={() => void toggleExpand(record)}>
                    {expanded ? '收起' : '查看已读'}
                  </Button>
                </div>
                {expanded ? (
                  <div className="mt-2 rounded bg-slate-50 p-3">
                    {status === 'loading' || status === undefined ? (
                      <Spin size="small" />
                    ) : status === 'error' ? (
                      <span className="text-xs text-red-500">
                        查询失败，可能已超过飞书 7 天可查期限，或消息/群信息已失效。
                      </span>
                    ) : (
                      <>
                        <Progress
                          percent={status.totalMembers > 0 ? Math.round((status.readCount / status.totalMembers) * 100) : 0}
                          size="small"
                        />
                        <div className="mb-2 text-xs text-slate-500">
                          已读 {status.readCount} / {status.totalMembers} 人
                        </div>
                        <div className="space-y-1">
                          <div>
                            <span className="text-xs font-semibold text-emerald-600">已读：</span>
                            {status.readUsers.length === 0 ? (
                              <span className="text-xs text-slate-400">暂无</span>
                            ) : (
                              status.readUsers.map((u) => (
                                <Tooltip key={u.userId} title={u.userId}>
                                  <Tag color="green">{u.name || u.userId}</Tag>
                                </Tooltip>
                              ))
                            )}
                          </div>
                          <div>
                            <span className="text-xs font-semibold text-amber-600">未读：</span>
                            {status.unreadUsers.length === 0 ? (
                              <span className="text-xs text-slate-400">暂无</span>
                            ) : (
                              status.unreadUsers.map((u) => (
                                <Tooltip key={u.userId} title={u.userId}>
                                  <Tag color="orange">{u.name || u.userId}</Tag>
                                </Tooltip>
                              ))
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </List.Item>
            )
          }}
        />
      )}
    </Modal>
  )
}
