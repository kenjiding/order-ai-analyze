import { useEffect } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import { ACCOUNT_KINDS, accountKindLabel } from '../../../containerManagement/constants'
import type { ContainerAccount } from '../../../containerManagement/types'
import type { AccountDraft } from '../useContainerAccountsPage'

type Props = {
  open: boolean
  editing: ContainerAccount | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (draft: AccountDraft) => Promise<boolean>
}

export function AccountFormModal({ open, editing, submitting, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<AccountDraft>()

  useEffect(() => {
    if (!open) return
    form.setFieldsValue(
      editing
        ? { name: editing.name, kind: editing.kind }
        : { name: '', kind: 'CUSTOMER' },
    )
  }, [open, editing, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const ok = await onSubmit({ name: values.name.trim(), kind: values.kind })
      if (ok) form.resetFields()
    } catch {
      /* 表单校验失败，保留在弹窗内 */
    }
  }

  return (
    <Modal
      title={editing ? '编辑主体账户' : '新增主体账户'}
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
            {editing ? '保存' : '创建'}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          label="名称"
          name="name"
          rules={[
            { required: true, message: '请填写主体名称' },
            { max: 200, message: '名称最长 200 字' },
          ]}
        >
          <Input placeholder="例如：墨尔本一号仓" allowClear />
        </Form.Item>
        <Form.Item label="类型" name="kind" rules={[{ required: true, message: '请选择类型' }]}>
          <Select
            options={ACCOUNT_KINDS.map((kind) => ({ value: kind, label: accountKindLabel[kind] }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
