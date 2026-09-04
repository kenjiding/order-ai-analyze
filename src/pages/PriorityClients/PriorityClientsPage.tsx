import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Form, Input, Modal, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { backendFetch } from '../../api/httpClient'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'

export type PriorityClient = {
  id: string
  clientCode: string
  clientName: string
  isVip: boolean
}

type ClientDraft = Omit<PriorityClient, 'id'>

async function callApi<T>(path: string, options?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(`/api/priority-clients${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: string }
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch {
    return { ok: false, error: '无法访问后端' }
  }
}

type FormValues = {
  clientCode: string
  clientName: string
  isVip?: boolean
}

export default function PriorityClientsPage() {
  const [form] = Form.useForm<FormValues>()
  const [clients, setClients] = useState<PriorityClient[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<PriorityClient | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await callApi<PriorityClient[]>('')
    setLoading(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setClients(res.data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openForm = useCallback(
    (record: PriorityClient | null) => {
      setEditing(record)
      form.setFieldsValue({
        clientCode: record?.clientCode ?? '',
        clientName: record?.clientName ?? '',
        isVip: record?.isVip ?? false,
      })
      setFormOpen(true)
    },
    [form],
  )

  const submit = useCallback(async () => {
    const values = await form.validateFields()
    const draft: ClientDraft = {
      clientCode: values.clientCode.trim(),
      clientName: values.clientName.trim(),
      isVip: values.isVip === true,
    }
    setSubmitting(true)
    const res = editing
      ? await callApi<PriorityClient>(`/${editing.id}`, { method: 'PUT', body: JSON.stringify(draft) })
      : await callApi<PriorityClient>('', { method: 'POST', body: JSON.stringify(draft) })
    setSubmitting(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setClients((prev) =>
      editing
        ? prev.map((item) => (item.id === res.data.id ? res.data : item))
        : [...prev, res.data].sort((a, b) => a.clientCode.localeCompare(b.clientCode)),
    )
    showToast(editing ? '已更新优先客户' : '已新增优先客户', 'success')
    setFormOpen(false)
    setEditing(null)
  }, [editing, form])

  const remove = useCallback(async (record: PriorityClient) => {
    const confirmed = await confirmDialog({
      title: `确认移除优先客户「${record.clientName}」？`,
      content: `商家编码 ${record.clientCode} 将从优先客户名单中删除。`,
      danger: true,
    })
    if (!confirmed) return
    const res = await callApi<{ id: string }>(`/${record.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setClients((prev) => prev.filter((item) => item.id !== record.id))
    showToast('已移除优先客户', 'success')
  }, [])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return clients
    return clients.filter((item) =>
      [item.clientCode, item.clientName].some((field) => field.toLowerCase().includes(kw)),
    )
  }, [clients, keyword])

  const columns: ColumnsType<PriorityClient> = [
    {
      title: '商家编码 / Client Code',
      dataIndex: 'clientCode',
      key: 'clientCode',
      width: 180,
      render: (value: string) => <span className="font-medium tabular-nums text-slate-900">{value}</span>,
    },
    {
      title: '商家名称 / Client Name',
      dataIndex: 'clientName',
      key: 'clientName',
    },
    {
      title: 'VIP',
      dataIndex: 'isVip',
      key: 'isVip',
      width: 80,
      render: (value: boolean) =>
        value ? <Tag color="gold">VIP</Tag> : <span className="text-slate-400">—</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_, record) => (
        <div className="flex items-center gap-1">
          <Button
            type="text"
            icon={<Pencil className="h-4 w-4" aria-hidden />}
            onClick={() => openForm(record)}
            aria-label="编辑"
          />
          <Button
            type="text"
            danger
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            onClick={() => void remove(record)}
            aria-label="删除"
          />
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
              <Star className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">优先客户配置</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                维护需要优先处理的商家名单，勾选 VIP 的为 VIP 客户。
              </p>
            </div>
          </div>
          <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => openForm(null)}>
            新增优先客户
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Input.Search
            allowClear
            className="w-56"
            placeholder="搜索商家编码 / 名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">
            当前优先客户：{filtered.length} / {clients.length}
          </span>
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <Table<PriorityClient>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          scroll={{ x: 620 }}
          locale={{ emptyText: '暂无优先客户' }}
        />
      </section>

      <Modal
        open={formOpen}
        title={editing ? '编辑优先客户' : '新增优先客户'}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item
            name="clientCode"
            label="商家编码 / Client Code"
            rules={[{ required: true, message: '请输入商家编码' }]}
          >
            <Input placeholder="如 C2104339201" />
          </Form.Item>
          <Form.Item
            name="clientName"
            label="商家名称 / Client Name"
            rules={[{ required: true, message: '请输入商家名称' }]}
          >
            <Input placeholder="如 ZtoZ" />
          </Form.Item>
          <Form.Item name="isVip" valuePropName="checked" className="mb-0">
            <Checkbox>VIP 客户</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
