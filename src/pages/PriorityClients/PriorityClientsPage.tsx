import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Form, Input, Modal, Table, Tag, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Pencil, Plus, Star, Trash2, Upload as UploadIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'
import { parsePriorityClientFile } from './priorityClientsImport'

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
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch {
    return { ok: false, error: '' }
  }
}

type FormValues = {
  clientCode: string
  clientName: string
  isVip?: boolean
}

export default function PriorityClientsPage() {
  const { t } = useTranslation('priorityClients')
  const { t: tc } = useTranslation('common')
  const [form] = Form.useForm<FormValues>()
  const [clients, setClients] = useState<PriorityClient[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<PriorityClient | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await callApi<PriorityClient[]>('')
    setLoading(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setClients(res.data)
  }, [t])

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
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setClients((prev) =>
      editing
        ? prev.map((item) => (item.id === res.data.id ? res.data : item))
        : [...prev, res.data].sort((a, b) => a.clientCode.localeCompare(b.clientCode)),
    )
    showToast(editing ? t('toastUpdated') : t('toastAdded'), 'success')
    setFormOpen(false)
    setEditing(null)
  }, [editing, form, t])

  const remove = useCallback(async (record: PriorityClient) => {
    const confirmed = await confirmDialog({
      title: t('confirmRemoveTitle', { name: record.clientName }),
      content: t('confirmRemoveContent', { code: record.clientCode }),
      danger: true,
    })
    if (!confirmed) return
    const res = await callApi<{ id: string }>(`/${record.id}`, { method: 'DELETE' })
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setClients((prev) => prev.filter((item) => item.id !== record.id))
    showToast(t('toastRemoved'), 'success')
  }, [t])

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true)
      const parsed = await parsePriorityClientFile(file)
      if (!parsed.ok) {
        setImporting(false)
        showToast(t(`importErr${parsed.error.charAt(0).toUpperCase()}${parsed.error.slice(1)}`), 'error')
        return
      }
      const res = await callApi<{ inserted: number; skipped: number }>('/bulk', {
        method: 'POST',
        body: JSON.stringify({ clients: parsed.clients }),
      })
      setImporting(false)
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      showToast(t('importDone', res.data), 'success')
      await load()
    },
    [load, t],
  )

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return clients
    return clients.filter((item) =>
      [item.clientCode, item.clientName].some((field) => field.toLowerCase().includes(kw)),
    )
  }, [clients, keyword])

  const columns: ColumnsType<PriorityClient> = useMemo(
    () => [
      {
        title: t('colClientCode'),
        dataIndex: 'clientCode',
        key: 'clientCode',
        width: 180,
        render: (value: string) => <span className="font-medium tabular-nums text-slate-900">{value}</span>,
      },
      {
        title: t('colClientName'),
        dataIndex: 'clientName',
        key: 'clientName',
      },
      {
        title: t('colVip'),
        dataIndex: 'isVip',
        key: 'isVip',
        width: 80,
        render: (value: boolean) =>
          value ? <Tag color="gold">VIP</Tag> : <span className="text-slate-400">—</span>,
      },
      {
        title: t('colActions'),
        key: 'actions',
        width: 110,
        fixed: 'right',
        render: (_, record) => (
          <div className="flex items-center gap-1">
            <Button
              type="text"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => openForm(record)}
              aria-label={t('editAria')}
            />
            <Button
              type="text"
              danger
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => void remove(record)}
              aria-label={t('deleteAria')}
            />
          </div>
        ),
      },
    ],
    [openForm, remove, t],
  )

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <Star className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('title')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Upload
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={(file) => {
                void importFile(file)
                return false
              }}
            >
              <Button loading={importing} icon={<UploadIcon className="h-4 w-4" aria-hidden />}>
                {t('importClients')}
              </Button>
            </Upload>
            <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => openForm(null)}>
              {t('addClient')}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Input.Search
            allowClear
            className="w-56"
            placeholder={t('searchPlaceholder')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">
            {t('clientCount', { filtered: filtered.length, total: clients.length })}
          </span>
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <Table<PriorityClient>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('tableTotal', { total }) }}
          scroll={{ x: 620 }}
          locale={{ emptyText: t('emptyText') }}
        />
      </section>

      <Modal
        open={formOpen}
        title={editing ? t('editClient') : t('addClient')}
        okText={tc('save')}
        cancelText={tc('cancel')}
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
            label={t('colClientCode')}
            rules={[{ required: true, message: t('clientCodeRequired') }]}
          >
            <Input placeholder={t('clientCodePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="clientName"
            label={t('colClientName')}
            rules={[{ required: true, message: t('clientNameRequired') }]}
          >
            <Input placeholder={t('clientNamePlaceholder')} />
          </Form.Item>
          <Form.Item name="isVip" valuePropName="checked" className="mb-0">
            <Checkbox>{t('vipClient')}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
