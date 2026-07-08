import type { ModalProps } from 'antd'
import { Col, Form, Input, Modal, Row, Select } from 'antd'
import { useEffect } from 'react'
import { webhookFieldRules } from '../pushEntryFormValidators'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import type { FleetSupplierConfig, FleetSupplierConfigDraft } from '../fleetSupplierPushTypes'
import { FEISHU_WEBHOOK_PREFIX } from '../feishuPushTypes'
import { FeishuLarkMdEditor } from '../../../components/FeishuLarkMdEditor'

type VendorOption = {
  vendorCode: string
  vendorNameEn: string
}

type FormValues = {
  vendorCode: string
  supplierNickname: string
  routeCode: string
  webhookUrl: string
  signingSecret?: string
  pushContent: string
}

type Props = Omit<ModalProps, 'onOk' | 'onCancel'> & {
  open: boolean
  editing: FleetSupplierConfig | null
  vendors: VendorOption[]
  vendorsLoading: boolean
  onCancel: () => void
  onCommitted: (values: FleetSupplierConfigDraft) => void | Promise<void>
  /** 独立入口页：不展示、不编辑 webhook 与密钥 */
  secretsVisibility?: 'full' | 'hidden'
}

export function FleetSupplierEditModal({
  open,
  editing,
  vendors,
  vendorsLoading,
  onCancel,
  onCommitted,
  secretsVisibility = 'full',
  ...rest
}: Props) {
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    if (editing) {
      const base = {
        vendorCode: editing.vendorCode,
        supplierNickname: editing.supplierNickname,
        routeCode: editing.routeCode,
        pushContent: editing.pushContent,
      }
      if (secretsVisibility === 'full') {
        form.setFieldsValue({
          ...base,
          webhookUrl: editing.webhookUrl,
          signingSecret: editing.signingSecret,
        })
      } else {
        form.setFieldsValue(base)
      }
    } else if (secretsVisibility === 'full') {
      form.setFieldsValue({
        vendorCode: undefined,
        supplierNickname: '',
        routeCode: '',
        webhookUrl: '',
        signingSecret: '',
        pushContent: '',
      })
    } else {
      form.setFieldsValue({
        vendorCode: undefined,
        supplierNickname: '',
        routeCode: '',
        pushContent: '',
      })
    }
  }, [open, editing, form, secretsVisibility])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const selectedVendor = vendors.find((v) => v.vendorCode === values.vendorCode)
      const base: FleetSupplierConfigDraft = {
        vendorCode: values.vendorCode,
        vendorName: selectedVendor?.vendorNameEn ?? values.vendorCode,
        supplierNickname: values.supplierNickname.trim(),
        routeCode: typeof values.routeCode === 'string' ? values.routeCode.trim() : '',
        pushDescription: editing?.pushDescription ?? null,
        pushContent: typeof values.pushContent === 'string' ? values.pushContent : '',
        webhookUrl: editing?.webhookUrl?.trim() ?? '',
        signingSecret: editing?.signingSecret,
      }
      if (secretsVisibility === 'hidden') {
        await Promise.resolve(onCommitted(base))
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
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="供应商"
              name="vendorCode"
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
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="供应商昵称"
              name="supplierNickname"
              rules={[{ required: true, message: '请填写供应商昵称' }]}
              tooltip="推送消息中展示的称呼，可与 iMile 供应商名称不同"
            >
              <Input placeholder="例如：华南承运商 A" allowClear />
            </Form.Item>
          </Col>
        </Row>

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
          label="供应商推送内容"
          name="pushContent"
          extra="将先于图片以富文本卡片推送至群内；与 Tab 顶部「推送内容」拼接为本条消息正文（本段在上、顶部段在下），任一段可留空。"
        >
          <FeishuLarkMdEditor rows={5} placeholder="例如：【货量日报】以下为按邮编/城市汇总单量。" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
