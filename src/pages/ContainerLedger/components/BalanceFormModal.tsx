import { useEffect } from 'react'
import { Button, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { useActiveContainerTypes } from '../../../containerManagement/containerTypeStore'
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
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [form] = Form.useForm<CreateValues & EditValues>()
  const isEdit = mode === 'edit'
  // 停用的品类不出现在新建下拉里：停用意味着不再产生新记录，历史数据照常展示
  const activeTypes = useActiveContainerTypes()

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
      title={isEdit ? t('ledger.modalEditTitle') : t('ledger.modalCreateTitle')}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
            {isEdit ? tc('save') : t('ledger.create')}
          </Button>
        </div>
      }
    >
      {isEdit && editing ? (
        <p className="mt-4 text-sm text-slate-500">
          {editing.accountName} · {t(`containerType.${editing.containerType}`)}
          {t('currentQuantity', { quantity: editing.quantity })}
        </p>
      ) : null}
      <Form form={form} layout="vertical" className="mt-4">
        {!isEdit ? (
          <>
            <Form.Item
              label={t('ledger.colAccount')}
              name="accountId"
              rules={[{ required: true, message: t('ledger.selectAccount') }]}
            >
              <Select
                placeholder={t('selectPlaceholder')}
                showSearch
                optionFilterProp="label"
                options={accounts.map((account) => ({ value: account.id, label: account.name }))}
              />
            </Form.Item>
            <Form.Item
              label={t('ledger.colType')}
              name="containerType"
              rules={[{ required: true, message: t('ledger.selectType') }]}
            >
              <Select
                options={activeTypes.map((type) => ({
                  value: type.code,
                  label: t(`containerType.${type.code}`),
                }))}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item
          label={t('ledger.colQuantity')}
          name="quantity"
          rules={[{ required: true, message: t('ledger.enterQuantity') }]}
        >
          <InputNumber className="w-full" min={0} step={1} precision={0} />
        </Form.Item>
        {isEdit ? (
          <>
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
          </>
        ) : null}
      </Form>
    </Modal>
  )
}
