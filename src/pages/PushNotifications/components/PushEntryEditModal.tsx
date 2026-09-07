import type { ModalProps } from 'antd'
import { Col, Form, Input, Modal, Row, Select, Switch, TimePicker, Typography } from 'antd'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  FEISHU_PUSH_KIND_ORDER,
  feishuPushKindLabel,
  type FeishuPushEntryWithKind,
  type FeishuPushKind,
} from '../feishuPushTypes'

type Props = Omit<ModalProps, 'onOk' | 'onCancel'> & {
  editing: FeishuPushEntryWithKind | null
  /** 新建推送时，Select 默认值 */
  defaultKindForNew?: FeishuPushKind
  /** 为 false 时不展示「推送类型」，kind 固定为 defaultKindForNew / 编辑项原 kind */
  showKindField?: boolean
  open: boolean
  onCancel: () => void
  onCommitted: (entry: PushEntryDraft) => void
}

export function PushEntryEditModal({
  editing,
  defaultKindForNew = FEISHU_PUSH_DEFAULT_KIND,
  showKindField = true,
  open,
  onCancel,
  onCommitted,
  ...rest
}: Props) {
  const { t } = useTranslation('pushNotifications')
  const [form] = Form.useForm<PushFormRow>()
  const kindOptions = useMemo(
    () =>
      FEISHU_PUSH_KIND_ORDER.map((value) => ({
        value,
        label: feishuPushKindLabel(value),
      })),
    [t],
  )
  const webhookRules = useMemo(() => webhookFieldRules(), [t])

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

  const title = editing ? t('entryModal.editTitle') : t('entryModal.addTitle')

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      width={800}
      destroyOnHidden
      okText={editing ? t('entryModal.saveChanges') : t('common.add')}
      cancelText={t('common.cancel')}
      {...rest}
    >
      <Form form={form} layout="vertical" requiredMark={false} className="pt-2">
        <Form.Item name="id" hidden>
          <Input />
        </Form.Item>

        {!showKindField ? (
          <Form.Item name="kind" hidden>
            <Input />
          </Form.Item>
        ) : null}

        <Row gutter={[16, 8]} align="bottom">
          <Col xs={24} sm={showKindField ? 12 : 24}>
            <Form.Item
              label={
                <span>
                  {t('entryModal.pushName')} <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="pushName"
              rules={[{ required: true, message: t('entryModal.pushNameRequired') }]}
            >
              <Input placeholder={t('entryModal.pushNamePlaceholder')} maxLength={64} showCount />
            </Form.Item>
          </Col>
          {showKindField ? (
            <Col xs={24} sm={12}>
              <Form.Item
                label={
                  <span>
                    {t('entryModal.kind')} <Typography.Text type="danger">*</Typography.Text>
                  </span>
                }
                name="kind"
                rules={[{ required: true, message: t('entryModal.kindRequired') }]}
              >
                <Select options={kindOptions} placeholder={t('entryModal.kindPlaceholder')} />
              </Form.Item>
            </Col>
          ) : null}
          <Col xs={24} sm={12}>
            <Form.Item
              label={
                <span>
                  {t('entryModal.pushTime')} <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="pushTimeHm"
              rules={[{ required: true, message: t('entryModal.pushTimeRequired') }]}
            >
              <TimePicker format="HH:mm" minuteStep={1} className="w-full" needConfirm={false} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={
                <span>
                  {t('entryModal.webhook')} <Typography.Text type="danger">*</Typography.Text>
                </span>
              }
              name="webhookUrl"
              rules={webhookRules}
            >
              <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label={t('entryModal.signingSecret')} name="signingSecret">
              <Input.Password autoComplete="new-password" placeholder={t('entryModal.signingSecretPlaceholder')} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label={t('entryModal.status')} name="isDisabled" valuePropName="checked">
              <Switch checkedChildren={t('entryModal.statusDisabled')} unCheckedChildren={t('entryModal.statusEnabled')} />
            </Form.Item>
          </Col>
        </Row>

        <Typography.Paragraph type="secondary" className="!mb-3 text-xs leading-relaxed">
          {t('entryModal.scheduleHint')}
        </Typography.Paragraph>

        <Form.Item label={t('entryModal.description')} name="pushDescription">
          <Input.TextArea rows={2} placeholder={t('entryModal.descriptionPlaceholder')} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  )
}
