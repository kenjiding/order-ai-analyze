import { Form, Input, Modal, Select } from 'antd'
import { useEffect } from 'react'
import type { VendorOption, VendorPushConfig, VendorPushConfigDraft } from '../vendorAnalysisTypes'

type Props = {
  open: boolean
  editing: VendorPushConfig | null
  vendors: VendorOption[]
  vendorsLoading: boolean
  onCancel: () => void
  onCommit: (draft: VendorPushConfigDraft) => Promise<boolean>
}

type FormValues = {
  vendorCode: string
  webhookUrl: string
  signingSecret?: string
  pushDescription?: string
}

export function VendorPushConfigModal({
  open,
  editing,
  vendors,
  vendorsLoading,
  onCancel,
  onCommit,
}: Props) {
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (open) {
      form.setFieldsValue(
        editing
          ? {
              vendorCode: editing.vendorCode,
              webhookUrl: editing.webhookUrl,
              signingSecret: editing.signingSecret ?? '',
              pushDescription: editing.pushDescription ?? '',
            }
          : { vendorCode: undefined, webhookUrl: '', signingSecret: '', pushDescription: '' },
      )
    }
  }, [open, editing, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    const selectedVendor = vendors.find((v) => v.vendorCode === values.vendorCode)
    const draft: VendorPushConfigDraft = {
      vendorCode: values.vendorCode,
      vendorName: selectedVendor?.vendorNameEn ?? values.vendorCode,
      webhookUrl: values.webhookUrl.trim(),
      signingSecret: values.signingSecret?.trim() || null,
      pushDescription: values.pushDescription?.trim() || null,
      isDisabled: editing?.isDisabled ?? false,
    }
    const ok = await onCommit(draft)
    if (ok) form.resetFields()
  }

  return (
    <Modal
      open={open}
      title={editing ? '编辑推送配置' : '新增推送配置'}
      okText={editing ? '保存' : '添加'}
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => void handleOk()}
      width={560}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" className="pt-2">
        <Form.Item
          name="vendorCode"
          label="供应商"
          rules={[{ required: true, message: '请选择供应商' }]}
        >
          <Select
            showSearch
            loading={vendorsLoading}
            placeholder="搜索并选择供应商"
            filterOption={(input, opt) =>
              (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={vendors.map((v) => ({
              label: `${v.vendorNameEn} (${v.vendorCode})`,
              value: v.vendorCode,
            }))}
          />
        </Form.Item>

        <Form.Item
          name="webhookUrl"
          label="飞书 Webhook 地址"
          rules={[
            { required: true, message: '请填写 Webhook 地址' },
            {
              validator: (_, value) => {
                if (!value || value.includes('open.feishu.cn/open-apis/bot/v2/hook/')) {
                  return Promise.resolve()
                }
                return Promise.reject('仅支持飞书官方 Webhook 地址')
              },
            },
          ]}
        >
          <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
        </Form.Item>

        <Form.Item name="signingSecret" label="签名密钥（选填）">
          <Input.Password placeholder="群机器人配置中的签名校验密钥" />
        </Form.Item>

        <Form.Item name="pushDescription" label="推送备注（选填）">
          <Input.TextArea
            rows={2}
            placeholder="该推送配置的用途说明，会附加在飞书消息底部"
            maxLength={200}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
