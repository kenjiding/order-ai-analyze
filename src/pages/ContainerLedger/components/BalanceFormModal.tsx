import { useEffect } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { CONTAINER_TYPES, containerTypeLabel } from '../../../containerManagement/constants'
import type {
  BalanceReasonType,
  ContainerAccount,
  ContainerBalance,
  ContainerType,
} from '../../../containerManagement/types'
import { ReasonTypeSelect } from './ReasonTypeSelect'
import type { BalanceCreateDraft, BalanceReasonDraft } from '../useContainerLedgerPage'

type CreateValues = { accountId: string; containerType: ContainerType; quantity: number }
type EditValues = { quantity: number; reasonType: BalanceReasonType; reason: string }

type Props = {
  mode: 'create' | 'edit'
  open: boolean
  accounts: ContainerAccount[]
  editing: ContainerBalance | null
  submitting: boolean
  onCancel: () => void
  onCreate: (draft: BalanceCreateDraft) => Promise<boolean>
  onEdit: (quantity: number, reason: BalanceReasonDraft) => Promise<boolean>
}

export function BalanceFormModal({
  mode,
  open,
  accounts,
  editing,
  submitting,
  onCancel,
  onCreate,
  onEdit,
}: Props) {
  const [form] = Form.useForm<CreateValues & EditValues>()
  const isEdit = mode === 'edit'

  useEffect(() => {
    if (!open) return
    if (isEdit && editing) {
      form.resetFields()
      form.setFieldsValue({ quantity: editing.quantity, reason: '' })
      return
    }
    form.resetFields()
    form.setFieldsValue({
      ...(accounts.length === 1 ? { accountId: accounts[0].id } : {}),
      containerType: 'BIG_BASKET',
      quantity: 0,
    })
  }, [open, isEdit, editing, accounts, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const ok = isEdit
        ? await onEdit(values.quantity, {
            reasonType: values.reasonType,
            reason: values.reason.trim(),
          })
        : await onCreate({
            accountId: values.accountId,
            containerType: values.containerType,
            quantity: values.quantity,
          })
      if (ok) form.resetFields()
    } catch {
      /* 表单校验失败，保留在弹窗内 */
    }
  }

  return (
    <Modal
      title={isEdit ? '编辑台账数量' : '新增台账记录'}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </div>
      }
    >
      {isEdit && editing ? (
        <p className="mt-4 text-sm text-slate-500">
          {editing.accountName} · {containerTypeLabel[editing.containerType]}（当前 {editing.quantity}）
        </p>
      ) : null}
      <Form form={form} layout="vertical" className="mt-4">
        {!isEdit ? (
          <>
            <Form.Item
              label="站点账户"
              name="accountId"
              rules={[{ required: true, message: '请选择站点账户' }]}
            >
              <Select
                placeholder="选择…"
                showSearch
                optionFilterProp="label"
                options={accounts.map((account) => ({ value: account.id, label: account.name }))}
              />
            </Form.Item>
            <Form.Item
              label="品类"
              name="containerType"
              rules={[{ required: true, message: '请选择品类' }]}
            >
              <Select
                options={CONTAINER_TYPES.map((type) => ({
                  value: type,
                  label: containerTypeLabel[type],
                }))}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item
          label="数量"
          name="quantity"
          rules={[{ required: true, message: '请填写数量' }]}
        >
          <InputNumber className="w-full" min={0} step={1} precision={0} />
        </Form.Item>
        {isEdit ? (
          <>
            <Form.Item
              label="原因类型"
              name="reasonType"
              rules={[{ required: true, message: '请选择原因类型' }]}
            >
              <ReasonTypeSelect />
            </Form.Item>
            <Form.Item
              label="变更原因"
              name="reason"
              rules={[
                { required: true, message: '请填写变更原因' },
                { max: 500, message: '变更原因最长 500 字' },
              ]}
            >
              <Input placeholder="必填" allowClear />
            </Form.Item>
          </>
        ) : null}
      </Form>
    </Modal>
  )
}
