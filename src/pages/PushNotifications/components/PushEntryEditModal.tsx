import type { ModalProps } from 'antd'
import { Col, Form, Input, Modal, Row, Select, Switch, TimePicker, Typography } from 'antd'
import { useEffect } from 'react'
import { webhookFieldRules } from '../pushEntryFormValidators'
import {
  createBlankPushFormRow,
  entriesToFormRows,
  formRowToDraft,
  type PushEntryDraft,
  type PushFormRow,
} from '../pushEntryFormTransforms'
import {
  FEISHU_PUSH_DEFAULT_KIND,
  FEISHU_PUSH_KIND_LABELS,
  FEISHU_PUSH_KIND_ORDER,
  type FeishuPushEntryWithKind,
  type FeishuPushKind,
} from '../feishuPushTypes'

type Props = Omit<ModalProps, 'onOk' | 'onCancel'> & {
  editing: FeishuPushEntryWithKind | null
  /** 新建推送时，Select 默认值 */
  defaultKindForNew?: FeishuPushKind
  open: boolean
  onCancel: () => void
  onCommitted: (entry: PushEntryDraft) => void
}

export function PushEntryEditModal({
  editing,
  defaultKindForNew = FEISHU_PUSH_DEFAULT_KIND,
  open,
  onCancel,
  onCommitted,
  ...rest
}: Props) {
  const [form] = Form.useForm<PushFormRow>()
  const kindOptions = FEISHU_PUSH_KIND_ORDER.map((value) => ({
    value,
    label: FEISHU_PUSH_KIND_LABELS[value],
  }))

  useEffect(() => {
    if (!open) return
    if (editing) {
      form.setFieldsValue(entriesToFormRows([editing], editing.kind)[0])
    } else {
      form.setFieldsValue(createBlankPushFormRow(defaultKindForNew))
    }
  }, [open, editing, defaultKindForNew, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      onCommitted(formRowToDraft(values))
    } catch {
      /* validated */
    }
  }

  const title = editing ? '编辑推送' : '添加推送'

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      width={800}
      destroyOnHidden
      okText={editing ? '保存修改' : '添加'}
      cancelText="取消"
      {...rest}
    >
      <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
        <Form.Item name="id" hidden>
          <Input />
        </Form.Item>

        <Row gutter={[16, 8]} align="bottom">
          <Col xs={24} sm={12}>
            <Form.Item
              label={
                <span>
                  推送类型 <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="kind"
              rules={[{ required: true, message: '请选择推送类型' }]}
            >
              <Select options={kindOptions} placeholder="请选择推送类型" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={
                <span>
                  推送名称 <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="pushName"
              rules={[{ required: true, message: '请填写推送名称' }]}
            >
              <Input placeholder="如：早班分拣日报" maxLength={64} showCount />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={
                <span>
                  推送时间点 <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="pushTimeHm"
              rules={[{ required: true, message: '请选择每日推送时间点' }]}
            >
              <TimePicker format="HH:mm" minuteStep={1} className="w-full" needConfirm={false} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={
                <span>
                  群 webhook 地址 <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="webhookUrl"
              rules={webhookFieldRules()}
            >
              <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="推送密钥（签名校验，可选）" name="signingSecret">
              <Input.Password autoComplete="new-password" placeholder="未启用签名校验可留空" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="状态" name="isDisabled" valuePropName="checked">
              <Switch checkedChildren="禁用" unCheckedChildren="启用" />
            </Form.Item>
          </Col>
        </Row>

        <Typography.Paragraph type="secondary" className="!mb-3 text-xs leading-relaxed">
          推送时间供后台调度使用，建议避开整点、半点；若开启签名校验，服务端发消息需在 JSON 根级携带{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">timestamp</code> 与 <code className="rounded bg-slate-100 px-1 py-0.5">sign</code>。
        </Typography.Paragraph>

        <Form.Item label="推送描述（可选）" name="pushDescription">
          <Input.TextArea rows={2} placeholder="备注用途、收件群名或对接人…" maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}
