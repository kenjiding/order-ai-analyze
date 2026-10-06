import type { ModalProps } from 'antd'
import { Button, Col, Form, Input, Modal, Row, Select } from 'antd'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { webhookFieldRules } from '../pushEntryFormValidators'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import type { FleetSupplierConfig, FleetSupplierConfigDraft } from '../fleetSupplierPushTypes'
import { FEISHU_WEBHOOK_PREFIX } from '../feishuPushTypes'
import {
  fetchFeishuAppBotChats,
  fetchFeishuChatMembers,
  type FeishuBotChatOption,
  type FeishuChatMemberOption,
} from '../feishuWebhookTestApi'
import { FeishuLarkMdEditor } from '../../../components/FeishuLarkMdEditor'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import type { SupplierMentionContact } from '../../../shared/supplierPushConfig'
import { showToast } from '../../../utils/toast'

type VendorOption = {
  vendorCode: string
  vendorNameEn: string
}

type FormValues = {
  vendorCode: string
  supplierNickname: string
  routeCode: string
  routeCodeWhitelist: string
  stationCode: string
  webhookUrl: string
  signingSecret?: string
  chatId?: string
  pushContent: string
  mentionOpenIds: SupplierMentionContact[]
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
  const { t } = useTranslation('pushNotifications')
  const [form] = Form.useForm<FormValues>()
  const stations = useGlobalFilterStore((s) => s.stations)
  const stationsLoading = useGlobalFilterStore((s) => s.stationsLoading)
  const [botChats, setBotChats] = useState<FeishuBotChatOption[]>([])
  const [botChatsLoading, setBotChatsLoading] = useState(false)
  const [chatMembers, setChatMembers] = useState<FeishuChatMemberOption[]>([])
  const [chatMembersLoading, setChatMembersLoading] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const watchedChatId = Form.useWatch('chatId', form)
  /** hidden 模式不展示/不编辑 chatId 表单项，但已保存的 chatId 仍可用来拉群成员供「@ 相关人员」选择 */
  const effectiveChatId = secretsVisibility === 'full' ? watchedChatId : (editing?.chatId ?? '')

  const webhookRules = useMemo(() => webhookFieldRules(false), [t])
  const watchedVendorCode = Form.useWatch('vendorCode', form)
  // 选了供应商：路由码选填（不填 = 该供应商全路由通吃）。未选供应商（纯路由码口径）：
  // 路由码必填，否则这条配置匹配不到任何运单，与后端 validateSupplierPushConfigCreate/Update 口径一致
  const routeCodeRules = useMemo(
    () => [
      {
        validator: async (_: unknown, value: unknown) => {
          if (watchedVendorCode) return
          const raw = typeof value === 'string' ? value : ''
          if (!parseFleetRouteCodes(raw).length) {
            throw new Error(t('fleetEdit.routeCodeRequiredWithoutVendor'))
          }
        },
      },
    ],
    [t, watchedVendorCode],
  )

  useEffect(() => {
    if (!open || secretsVisibility !== 'full') return
    setBotChatsLoading(true)
    void fetchFeishuAppBotChats()
      .then((res) => {
        if (!res.ok) {
          showToast(t('fleetEdit.botChatsFailed', { error: res.error }), 'error')
          return
        }
        setBotChats(res.chats)
      })
      .finally(() => setBotChatsLoading(false))
  }, [open, secretsVisibility, t])

  useEffect(() => {
    const chatId = typeof effectiveChatId === 'string' ? effectiveChatId.trim() : ''
    if (!open || !chatId) {
      setChatMembers([])
      return
    }
    setChatMembersLoading(true)
    void fetchFeishuChatMembers(chatId)
      .then((res) => {
        if (!res.ok) {
          showToast(t('fleetEdit.chatMembersFailed', { error: res.error }), 'error')
          return
        }
        setChatMembers(res.members)
      })
      .finally(() => setChatMembersLoading(false))
  }, [open, effectiveChatId, t])

  useEffect(() => {
    if (!open) return
    if (editing) {
      const base = {
        // 空串会被 Select 当成一个已选中的空选项，占掉 placeholder；未选供应商要回填 undefined
        vendorCode: editing.vendorCode || undefined,
        supplierNickname: editing.supplierNickname,
        routeCode: editing.routeCode,
        routeCodeWhitelist: editing.routeCodeWhitelist ?? '',
        stationCode: editing.stationCode ?? '',
        pushContent: editing.pushContent,
        mentionOpenIds: editing.mentionOpenIds ?? [],
      }
      if (secretsVisibility === 'full') {
        form.setFieldsValue({
          ...base,
          webhookUrl: editing.webhookUrl,
          signingSecret: editing.signingSecret,
          chatId: editing.chatId ?? '',
        })
      } else {
        form.setFieldsValue(base)
      }
    } else if (secretsVisibility === 'full') {
      form.setFieldsValue({
        vendorCode: undefined,
        supplierNickname: '',
        routeCode: '',
        routeCodeWhitelist: '',
        stationCode: '',
        webhookUrl: '',
        signingSecret: '',
        chatId: '',
        pushContent: '',
        mentionOpenIds: [],
      })
    } else {
      form.setFieldsValue({
        vendorCode: undefined,
        supplierNickname: '',
        routeCode: '',
        routeCodeWhitelist: '',
        stationCode: '',
        pushContent: '',
        mentionOpenIds: [],
      })
    }
  }, [open, editing, form, secretsVisibility])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()

      // 「更多」默认收起时，webhookUrl/signingSecret/stationCode/pushContent 对应的 Form.Item 根本没挂载，
      // antd 的 validateFields() 只统计当前挂载的字段，values 里这几项会是 undefined——
      // 不用 getFieldValue 直接读 store 的话，要么 .trim() 报错导致保存整个卡住，要么把没碰过的字段当空值提交，
      // 把数据库里原有的 webhook/密钥/站点/推送内容悄悄清空。
      const webhookUrlRaw = form.getFieldValue('webhookUrl')
      const webhookUrlValue = secretsVisibility === 'full' && typeof webhookUrlRaw === 'string' ? webhookUrlRaw.trim() : ''
      const signingSecretRaw = form.getFieldValue('signingSecret')
      const stationCodeRaw = form.getFieldValue('stationCode')
      const pushContentRaw = form.getFieldValue('pushContent')

      const chatIdValue = typeof values.chatId === 'string' ? values.chatId.trim() : ''
      if (secretsVisibility === 'full' && !chatIdValue && !webhookUrlValue) {
        setMoreOpen(true)
        showToast(t('fleetEdit.webhookOrChatRequired'), 'error')
        return
      }

      // 供应商可不选（纯路由码口径）；此时 vendorCode / vendorName 一并留空
      const vendorCodeValue = typeof values.vendorCode === 'string' ? values.vendorCode.trim() : ''
      const selectedVendor = vendors.find((v) => v.vendorCode === vendorCodeValue)
      const base: FleetSupplierConfigDraft = {
        vendorCode: vendorCodeValue,
        vendorName: vendorCodeValue ? (selectedVendor?.vendorNameEn ?? vendorCodeValue) : '',
        supplierNickname: values.supplierNickname.trim(),
        routeCode: typeof values.routeCode === 'string' ? values.routeCode.trim() : '',
        routeCodeWhitelist:
          typeof values.routeCodeWhitelist === 'string' ? values.routeCodeWhitelist.trim() : '',
        stationCode: typeof stationCodeRaw === 'string' ? stationCodeRaw.trim() : '',
        pushDescription: editing?.pushDescription ?? null,
        pushContent: typeof pushContentRaw === 'string' ? pushContentRaw : '',
        mentionOpenIds: (Array.isArray(values.mentionOpenIds) ? values.mentionOpenIds : [])
          .map((c) => ({ name: (c?.name ?? '').trim(), openId: (c?.openId ?? '').trim() }))
          .filter((c) => c.openId.length > 0),
        webhookUrl: editing?.webhookUrl?.trim() ?? '',
        signingSecret: editing?.signingSecret,
        chatId: editing?.chatId ?? '',
      }
      if (secretsVisibility === 'hidden') {
        await Promise.resolve(onCommitted(base))
        return
      }
      await Promise.resolve(
        onCommitted({
          ...base,
          webhookUrl: webhookUrlValue,
          signingSecret:
            typeof signingSecretRaw === 'string' && signingSecretRaw.trim() !== '' ? signingSecretRaw.trim() : undefined,
          chatId: chatIdValue,
        }),
      )
    } catch (err) {
      const errorFields = (err as { errorFields?: Array<{ name: (string | number)[]; errors: string[] }> })
        ?.errorFields
      if (!errorFields?.length) return
      // 「更多」里的字段校验失败时默认是收起的，用户看不到红字提示，先展开
      const moreFieldNames = new Set(['webhookUrl', 'stationCode', 'pushContent'])
      if (errorFields.some((f) => moreFieldNames.has(String(f.name[0])))) {
        setMoreOpen(true)
      }
      const firstMsg = errorFields[0]?.errors?.[0]
      showToast(
        firstMsg ? t('toast.saveFailedWithReason', { reason: firstMsg }) : t('toast.saveFailedCheckForm'),
        'error',
      )
    }
  }

  const hasChatId = Boolean(typeof effectiveChatId === 'string' && effectiveChatId.trim())
  const mentionField = (
    <Form.Item
      label={t('fleetEdit.mentionLabel')}
      name="mentionOpenIds"
      tooltip={hasChatId ? t('fleetEdit.mentionTooltipWithChat') : t('fleetEdit.mentionTooltipNoChat')}
      getValueProps={(value: SupplierMentionContact[] | undefined) => ({
        value: (value ?? []).map((c) => c.openId),
      })}
      normalize={(value: string[] | undefined) =>
        (value ?? []).map((openId) => ({
          openId,
          name: chatMembers.find((m) => m.userId === openId)?.name ?? '',
        }))
      }
    >
      <Select
        mode="multiple"
        showSearch
        allowClear
        disabled={!hasChatId}
        loading={chatMembersLoading}
        placeholder={hasChatId ? t('fleetEdit.mentionPlaceholder') : t('fleetEdit.mentionPlaceholderNoChat')}
        notFoundContent={chatMembersLoading ? t('common.loading') : t('fleetEdit.mentionNotFound')}
        filterOption={(input, opt) => (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())}
        options={chatMembers.map((m) => ({ label: m.name || m.userId, value: m.userId }))}
      />
    </Form.Item>
  )

  return (
    <Modal
      title={editing ? t('fleetEdit.editTitle') : t('fleetEdit.addTitle')}
      open={open}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      width={640}
      destroyOnHidden
      okText={editing ? t('common.save') : t('common.add')}
      cancelText={t('common.cancel')}
      {...rest}
    >
      <Form form={form} layout="vertical" className="pt-2">
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item label={t('fleetEdit.vendor')} name="vendorCode" tooltip={t('fleetEdit.vendorTooltip')}>
              <Select
                showSearch
                allowClear
                loading={vendorsLoading}
                placeholder={t('fleetEdit.vendorPlaceholder')}
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
              label={t('fleetEdit.nickname')}
              name="supplierNickname"
              rules={[{ required: true, message: t('fleetEdit.nicknameRequired') }]}
              tooltip={t('fleetEdit.nicknameTooltip')}
            >
              <Input placeholder={t('fleetEdit.nicknamePlaceholder')} allowClear />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label={t('fleetEdit.routeCode')}
              name="routeCode"
              rules={routeCodeRules}
              extra={t('fleetEdit.routeCodeExtra')}
            >
              <Input.TextArea rows={4} placeholder={t('fleetEdit.routeCodePlaceholder')} allowClear />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label={t('fleetEdit.routeWhitelist')} name="routeCodeWhitelist" extra="">
              <Input.TextArea rows={4} placeholder={t('fleetEdit.routeCodePlaceholder')} allowClear />
            </Form.Item>
          </Col>
        </Row>

        {secretsVisibility === 'full' ? (
          <>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label={t('fleetEdit.feishuChatId')}
                  name="chatId"
                  tooltip={t('fleetEdit.feishuChatIdTooltip')}
                >
                  <Select
                    showSearch
                    allowClear
                    loading={botChatsLoading}
                    placeholder={t('fleetEdit.selectBotGroup')}
                    notFoundContent={botChatsLoading ? t('common.loading') : t('fleetEdit.botNotInAnyGroup')}
                    filterOption={(input, opt) =>
                      (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={botChats.map((c) => ({
                      label: c.name || t('fleetEdit.unnamedGroup', { chatId: c.chatId }),
                      value: c.chatId,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                {mentionField}
              </Col>
            </Row>

          </>
        ) : (
          mentionField
        )}

        <Button
          type="link"
          className="!px-0 !mb-2"
          icon={moreOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          onClick={() => setMoreOpen((v) => !v)}
        >
          {t('common.more')}
        </Button>

        {moreOpen ? (
          <div className="space-y-4">
            {secretsVisibility === 'full' ? (
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label={t('fleetEdit.feishuWebhook')} name="webhookUrl" rules={webhookRules}>
                    <Input placeholder={FEISHU_WEBHOOK_PREFIX} allowClear />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label={t('fleetEdit.feishuWebhookSecret')} name="signingSecret">
                    <Input.Password placeholder={t('fleetEdit.webhookSecretPlaceholder')} autoComplete="new-password" />
                  </Form.Item>
                </Col>
              </Row>
            ) : null}

            <Form.Item
              label={t('fleetEdit.stationCode')}
              name="stationCode"
              tooltip={t('fleetEdit.stationCodeTooltip')}
            >
              <Select
                allowClear
                showSearch
                loading={stationsLoading}
                placeholder={t('fleetEdit.selectStation')}
                filterOption={(input, opt) =>
                  (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={stations.map((s) => ({ label: s.label, value: s.value }))}
              />
            </Form.Item>

            <Form.Item label={t('fleetEdit.supplierPushContent')} name="pushContent" extra="">
              <FeishuLarkMdEditor rows={5} placeholder={t('fleetEdit.supplierPushContentPlaceholder')} />
            </Form.Item>
          </div>
        ) : null}
      </Form>
    </Modal>
  )
}
