import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Popconfirm, Switch, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import dayjs from 'dayjs'
import { backendFetch } from '../../api/httpClient'
import { showToast } from '../../utils/toast'

type FeishuOpenApiKeyListItem = {
  id: string
  name: string
  tokenMasked: string
  isDisabled: boolean
  createdAt: string
  lastUsedAt: string | null
}

async function callApi<T>(path: string, options?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(`/api/feishu-open-api-keys${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: string }
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch {
    return { ok: false, error: '' }
  }
}

function formatTime(value: string | null): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '从未'
}

export default function FeishuOpenApiKeysPage() {
  const [form] = Form.useForm<{ name: string }>()
  const [keys, setKeys] = useState<FeishuOpenApiKeyListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await callApi<FeishuOpenApiKeyListItem[]>('')
    setLoading(false)
    if (!res.ok) {
      showToast(res.error || '请求失败', 'error')
      return
    }
    setKeys(res.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = useCallback(async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    const res = await callApi<FeishuOpenApiKeyListItem & { token: string }>('', {
      method: 'POST',
      body: JSON.stringify({ name: values.name.trim() }),
    })
    setSubmitting(false)
    if (!res.ok) {
      showToast(res.error || '请求失败', 'error')
      return
    }
    setKeys((prev) => [res.data, ...prev])
    setFormOpen(false)
    form.resetFields()
    setNewToken(res.data.token)
  }, [form])

  const toggleDisabled = useCallback(async (record: FeishuOpenApiKeyListItem, isDisabled: boolean) => {
    const res = await callApi<FeishuOpenApiKeyListItem>(`/${record.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isDisabled }),
    })
    if (!res.ok) {
      showToast(res.error || '请求失败', 'error')
      return
    }
    setKeys((prev) => prev.map((item) => (item.id === record.id ? res.data : item)))
    showToast(isDisabled ? '已禁用' : '已启用', 'success')
  }, [])

  const remove = useCallback(async (record: FeishuOpenApiKeyListItem) => {
    const res = await callApi<{ id: string }>(`/${record.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast(res.error || '请求失败', 'error')
      return
    }
    setKeys((prev) => prev.filter((item) => item.id !== record.id))
    showToast('已删除', 'success')
  }, [])

  const copyToken = useCallback(async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      showToast('已复制', 'success')
    } catch {
      showToast('复制失败，请手动选中复制', 'error')
    }
  }, [])

  const columns: ColumnsType<FeishuOpenApiKeyListItem> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
      },
      {
        title: 'Token',
        dataIndex: 'tokenMasked',
        key: 'tokenMasked',
        render: (value: string) => <span className="font-mono text-slate-500">{value}</span>,
      },
      {
        title: '状态',
        key: 'isDisabled',
        width: 100,
        render: (_, record) => (
          <Switch
            checked={!record.isDisabled}
            onChange={(checked) => void toggleDisabled(record, !checked)}
            checkedChildren="启用"
            unCheckedChildren="禁用"
          />
        ),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 160,
        render: (value: string) => formatTime(value),
      },
      {
        title: '最近使用',
        dataIndex: 'lastUsedAt',
        key: 'lastUsedAt',
        width: 160,
        render: (value: string | null) => formatTime(value),
      },
      {
        title: '操作',
        key: 'actions',
        width: 90,
        fixed: 'right',
        render: (_, record) => (
          <Popconfirm
            title={`确定删除「${record.name}」这个 API Key？`}
            description="删除后外部系统用这个 key 调用会立即失效，且不可恢复。"
            onConfirm={() => void remove(record)}
          >
            <Button type="text" danger icon={<Trash2 className="h-4 w-4" aria-hidden />} aria-label="删除" />
          </Popconfirm>
        ),
      },
    ],
    [remove, toggleDisabled],
  )

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">飞书推送 API Key 管理</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                发放给外部系统调用「飞书推送开放 API」的凭证；可以新增、禁用/启用、删除，不支持编辑。
              </p>
            </div>
          </div>
          <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setFormOpen(true)}>
            新建 API Key
          </Button>
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <Table<FeishuOpenApiKeyListItem>
          rowKey="id"
          columns={columns}
          dataSource={keys}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 720 }}
          locale={{ emptyText: '暂无 API Key' }}
        />
      </section>

      <Modal
        open={formOpen}
        title="新建 API Key"
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => setFormOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item
            name="name"
            label="名称"
            extra="标识这个 key 发给了哪个外部团队/系统，纯备注用"
            rules={[{ required: true, message: '名称不能为空' }]}
          >
            <Input placeholder="例如：外部团队A" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={newToken !== null}
        title="API Key 已创建"
        footer={
          <Button type="primary" onClick={() => setNewToken(null)}>
            我已保存
          </Button>
        }
        onCancel={() => setNewToken(null)}
        closable={false}
        maskClosable={false}
      >
        <p className="text-sm text-slate-600">
          请立即复制保存，<span className="font-medium text-red-600">关闭后将无法再次查看完整 token</span>，只能删除重建。
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 p-3">
          <Typography.Text className="flex-1 break-all font-mono text-sm">{newToken}</Typography.Text>
          <Button
            type="text"
            icon={<Copy className="h-4 w-4" aria-hidden />}
            onClick={() => newToken && void copyToken(newToken)}
            aria-label="复制"
          />
        </div>
      </Modal>
    </div>
  )
}
