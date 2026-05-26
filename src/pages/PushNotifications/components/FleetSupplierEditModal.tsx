import type { ModalProps } from 'antd'
import { Form, Input, Modal } from 'antd'
import { useEffect } from 'react'
import { webhookFieldRules } from '../pushEntryFormValidators'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import type { FleetSupplierConfig } from '../fleetSupplierPushTypes'
import { FEISHU_WEBHOOK_PREFIX } from '../feishuPushTypes'

type FormValues = {
  supplierName: string
  routeCode: string
  webhookUrl: string
  signingSecret?: string
  pushContent: string
}

type Props = Omit<ModalProps, 'onOk' | 'onCancel'> & {
  open: boolean
  editing: FleetSupplierConfig | null
  onCancel: () => void
  onCommitted: (values: Omit<FleetSupplierConfig, 'id'>) => void | Promise<void>
  /** 独立入口页：不展示、不编辑 webhook 与密钥 */
  secretsVisibility?: 'full' | 'hidden'
}

export function FleetSupplierEditModal({
  open,
  editing,
  onCancel,
  onCommitted,
  secretsVisibility = 'full',
  ...rest
}: Props) {
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    if (editing) {
      if (secretsVisibility === 'full') {
        form.setFieldsValue({
          supplierName: editing.supplierName,
          routeCode: editing.routeCode,
          webhookUrl: editing.webhookUrl,
          signingSecret: editing.signingSecret,
          pushContent: editing.pushContent,
        })
      } else {
        form.setFieldsValue({
          supplierName: editing.supplierName,
          routeCode: editing.routeCode,
          pushContent: editing.pushContent,
        })
      }
    } else if (secretsVisibility === 'full') {
      form.setFieldsValue({
        supplierName: '',
        routeCode: '',
        webhookUrl: '',
        signingSecret: '',
        pushContent: '',
      })
    } else {
      form.setFieldsValue({
        supplierName: '',
        routeCode: '',
        pushContent: '',
      })
    }
  }, [open, editing, form, secretsVisibility])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const base = {
        supplierName: values.supplierName.trim(),
        routeCode: typeof values.routeCode === 'string' ? values.routeCode.trim() : '',
        pushContent: typeof values.pushContent === 'string' ? values.pushContent : '',
      }
      if (secretsVisibility === 'hidden') {
        await Promise.resolve(
          onCommitted({
            ...base,
            webhookUrl: editing?.webhookUrl?.trim() ?? '',
            signingSecret: editing?.signingSecret,
          }),
        )
        return
      }
      await Promise.resolve(
        onCommitted({
          ...base,
          webhookUrl: values.webhookUrl.trim(),
          signingSecret:
            typeof values.signingSecret === 'string' && values.signingSecret.trim() !== ''
              ? values.signingSecret.trim()
              : undefined,
        }),
      )
    } catch {
      /* validated */
    }
  }

  return (
    <Modal
      title={editing ? '编辑供应商' : '添加供应商'}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      width={640}
      destroyOnHidden
      okText={editing ? '保存' : '添加'}
      cancelText="取消"
      {...rest}
    >
      <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
        <Form.Item
          label="供应商名称"
          name="supplierName"
          rules={[{ required: true, message: '请填写供应商名称' }]}
        >
          <Input placeholder="例如：华南承运商 A" allowClear />
        </Form.Item>

        <Form.Item
          label="路由编码"
          name="routeCode"
          rules={[
            { required: true, message: '请填写路由编码' },
            {
              validator: async (_, value: unknown) => {
                const raw = typeof value === 'string' ? value : ''
                if (!parseFleetRouteCodes(raw).length) {
                  throw new Error('请至少填写一个有效路由编码（多个请用空格或逗号分隔）')
                }
              },
            },
          ]}
          extra="多个编码可用空格、换行、英文逗号或中文逗号分隔。"
        >
          <Input.TextArea
            rows={4}
            placeholder={'例如：RC001 RC002\n或 RC001，RC002'}
            allowClear
          />
        </Form.Item>

        {secretsVisibility === 'full' ? (
          <>
            <Form.Item label="飞书 webhook" name="webhookUrl" rules={webhookFieldRules()}>
              <Input placeholder={FEISHU_WEBHOOK_PREFIX} allowClear />
            </Form.Item>

            <Form.Item label="飞书 webhook 密钥" name="signingSecret">
              <Input.Password placeholder="可选；若群机器人开启签名校验则必填" autoComplete="new-password" />
            </Form.Item>
          </>
        ) : null}

        <Form.Item
          label="推送内容"
          name="pushContent"
          extra="将先于图片推送至群内；与 Tab 顶部「推送内容」拼接为本条消息正文（本段在上、顶部段在下），任一段可留空。"
        >
          <Input.TextArea rows={4} placeholder="例如：【货量日报】以下为按邮编/城市汇总单量。" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
