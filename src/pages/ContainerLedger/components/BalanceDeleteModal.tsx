import { useEffect } from 'react'
import { Alert, Button, Form, Input, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
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
      title={t('ledger.deleteTitle')}
      open={deleting !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button danger type="primary" loading={submitting} onClick={() => void handleOk()}>
            {t('ledger.confirmDelete')}
          </Button>
        </div>
      }
    >
      {deleting ? (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {deleting.accountName} · {t(`containerType.${deleting.containerType}`)}
            {t('currentQuantity', { quantity: deleting.quantity })}
          </p>
          {deleting.quantity > 0 ? (
            <Alert
              className="mt-3"
              type="warning"
              showIcon
              message={t('ledger.deleteStockWarning', { quantity: deleting.quantity })}
            />
          ) : null}
        </>
      ) : null}
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          label={t('ledger.reasonType')}
          name="reasonType"
          rules={[{ required: true, message: t('ledger.selectReasonType') }]}
        >
          <ReasonTypeSelect />
        </Form.Item>
        <Form.Item
          label={t('ledger.changeReason')}
          name="reason"
          rules={[
            { required: true, message: t('ledger.enterChangeReason') },
            { max: 500, message: t('ledger.changeReasonMax') },
          ]}
        >
          <Input placeholder={t('requiredPlaceholder')} allowClear />
        </Form.Item>
      </Form>
    </Modal>
  )
}
