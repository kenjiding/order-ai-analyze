/**
 * 容器品类维护：新增、改名、启停、删除。
 *
 * 界面上只有「名称」一个字段 —— 编码由后端自动生成，业务方心里想的是「托盘」而不是 PALLET。
 * 两条规则直接体现在交互上：
 *   - 已被引用的品类只能停用不能删（删除按钮禁用）—— 编码存在历史流转与台账里，删了就成孤儿；
 *   - 停用只挡新建，历史记录照常显示、照常参与对账结算。
 */
import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Popconfirm, Switch, Table, Tag, Tooltip } from 'antd'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  createContainerType,
  deleteContainerType,
  updateContainerType,
} from '../../../containerManagement/api'
import { loadContainerTypes, useContainerTypes } from '../../../containerManagement/containerTypeStore'
import type { ContainerTypeItem } from '../../../containerManagement/types'
import { usePermission } from '../../../hooks/usePermission'
import { showToast } from '../../../utils/toast'

export function ContainerTypePanel() {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const types = useContainerTypes()
  const canManage = usePermission('btn:container-ledger:manage-types')
  const [editing, setEditing] = useState<ContainerTypeItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm<{ name: string }>()

  const open = creating || editing !== null
  /** 停用最后一个启用品类会让新建流转/台账无品类可选，后端也会拒 —— 前端先挡住并说明 */
  const activeCount = types.filter((row) => row.active).length

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editing) form.setFieldsValue({ name: editing.name })
  }, [open, editing, form])

  const close = () => {
    setCreating(false)
    setEditing(null)
  }

  const submit = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSubmitting(true)
    const res = editing
      ? await updateContainerType(editing.code, { name: values.name })
      : await createContainerType({ name: values.name })
    setSubmitting(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    await loadContainerTypes(true)
    showToast(editing ? t('types.updated') : t('types.created'), 'success')
    close()
  }

  const toggleActive = async (row: ContainerTypeItem, active: boolean) => {
    const res = await updateContainerType(row.code, { active })
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    await loadContainerTypes(true)
    showToast(active ? t('types.enabled') : t('types.disabled'), 'success')
  }

  const remove = async (row: ContainerTypeItem) => {
    const res = await deleteContainerType(row.code)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    await loadContainerTypes(true)
    showToast(t('types.deleted'), 'success')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-slate-500">{t('types.hint')}</p>
        {canManage ? (
          <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            {t('types.add')}
          </Button>
        ) : null}
      </div>

      <Table<ContainerTypeItem>
        rowKey="code"
        dataSource={types}
        pagination={false}
        locale={{ emptyText: t('types.empty') }}
        scroll={{ x: 560 }}
        columns={[
          { title: t('types.colName'), dataIndex: 'name', key: 'name' },
          {
            title: t('types.colStatus'),
            key: 'active',
            width: 160,
            render: (_: unknown, row) =>
              canManage ? (
                <Tooltip title={row.active && activeCount === 1 ? t('types.lastActiveBlocked') : ''}>
                  <span className="inline-block">
                    <Switch
                      checked={row.active}
                      disabled={row.active && activeCount === 1}
                      onChange={(checked) => void toggleActive(row, checked)}
                      checkedChildren={t('types.active')}
                      unCheckedChildren={t('types.inactive')}
                    />
                  </span>
                </Tooltip>
              ) : (
                <Tag color={row.active ? 'green' : 'default'}>
                  {row.active ? t('types.active') : t('types.inactive')}
                </Tag>
              ),
          },
          {
            title: t('types.colUsage'),
            key: 'inUse',
            width: 120,
            render: (_: unknown, row) =>
              row.inUse ? (
                <Tag color="blue">{t('types.inUse')}</Tag>
              ) : (
                <span className="text-slate-400">{t('types.unused')}</span>
              ),
          },
          ...(canManage
            ? [
                {
                  title: tc('actions'),
                  key: 'actions',
                  width: 150,
                  render: (_: unknown, row: ContainerTypeItem) => (
                    <div className="flex items-center gap-1">
                      <Button type="link" onClick={() => setEditing(row)}>
                        {tc('edit')}
                      </Button>
                      {row.inUse ? (
                        // 禁用的按钮不触发 hover，tooltip 必须套一层 span 才弹得出来，
                        // 否则用户只看到一个灰按钮，不知道为什么点不了
                        <Tooltip title={t('types.deleteBlocked')}>
                          <span className="inline-block">
                            <Button type="link" danger disabled>
                              {tc('delete')}
                            </Button>
                          </span>
                        </Tooltip>
                      ) : (
                        <Popconfirm
                          title={t('types.deleteConfirm', { name: row.name })}
                          okText={tc('confirm')}
                          cancelText={tc('cancel')}
                          onConfirm={() => void remove(row)}
                        >
                          <Button type="link" danger>
                            {tc('delete')}
                          </Button>
                        </Popconfirm>
                      )}
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={editing ? t('types.editTitle') : t('types.addTitle')}
        open={open}
        onCancel={close}
        onOk={() => void submit()}
        confirmLoading={submitting}
        okText={tc('save')}
        cancelText={tc('cancel')}
        destroyOnHidden
        width={420}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            label={t('types.colName')}
            name="name"
            rules={[{ required: true, message: t('types.nameRequired') }]}
          >
            <Input maxLength={64} placeholder={t('types.namePlaceholder')} autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
