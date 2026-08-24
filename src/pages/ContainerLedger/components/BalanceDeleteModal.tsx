import { useEffect } from 'react'
import { Alert, Button, Form, Input, Modal } from 'antd'
import { containerTypeLabel } from '../../../containerManagement/constants'
import type { BalanceReasonType, ContainerBalance } from '../../../containerManagement/types'
import { ReasonTypeSelect } from './ReasonTypeSelect'
import type { BalanceReasonDraft } from '../useContainerLedgerPage'

type Values = { reasonType: BalanceReasonType; reason: string }

type Props = {
  deleting: ContainerBalance | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (reason: BalanceReasonDraft) => Promise<boolean>
}

export function BalanceDeleteModal({ deleting, submitting, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<Values>()

  useEffect(() => {
    if (deleting) form.resetFields()
  }, [deleting, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const ok = await onSubmit({ reasonType: values.reasonType, reason: values.reason.trim() })
      if (ok) form.resetFields()
    } catch {
      /* 表单校验失败，保留在弹窗内 */
    }
  }

  return (
    <Modal
      title="删除台账记录"
      open={deleting !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button danger type="primary" loading={submitting} onClick={() => void handleOk()}>
            确认删除
          </Button>
        </div>
      }
    >
      {deleting ? (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {deleting.accountName} · {containerTypeLabel[deleting.containerType]}（当前{' '}
            {deleting.quantity}）
          </p>
          {deleting.quantity > 0 ? (
            <Alert
              className="mt-3"
              type="warning"
              showIcon
              message={`该记录仍有 ${deleting.quantity} 个库存，删除后这部分数量将不再计入台账。`}
            />
          ) : null}
        </>
      ) : null}
      <Form form={form} layout="vertical" className="mt-4">
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
      </Form>
    </Modal>
  )
}
