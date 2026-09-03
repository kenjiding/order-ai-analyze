import type { ModalProps } from 'antd'
import { Button, Col, Form, Input, Modal, Row, Select } from 'antd'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!open || secretsVisibility !== 'full') return
    setBotChatsLoading(true)
    void fetchFeishuAppBotChats()
      .then((res) => {
        if (!res.ok) {
          showToast(`获取机器人所在群列表失败：${res.error}`, 'error')
          return
        }
        setBotChats(res.chats)
      })
      .finally(() => setBotChatsLoading(false))
  }, [open, secretsVisibility])

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
          showToast(`获取群成员列表失败：${res.error}`, 'error')
          return
        }
        setChatMembers(res.members)
      })
      .finally(() => setChatMembersLoading(false))
  }, [open, effectiveChatId])

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
        showToast('请至少填写「飞书群 Chat ID」或「飞书 webhook」中的一项。', 'error')
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
      showToast(firstMsg ? `保存失败：${firstMsg}` : '保存失败，请检查表单必填项。', 'error')
    }
  }

  const hasChatId = Boolean(typeof effectiveChatId === 'string' && effectiveChatId.trim())
  const mentionField = (
    <Form.Item
      label="@ 相关人员"
      name="mentionOpenIds"
      tooltip={
        hasChatId
          ? '从群成员中选择需要 @ 的人，可多选；各推送是否实际 @ 由该推送「是否 @ 相关人员」开关决定，命中时取第 1 位'
          : '需先选择「飞书群 Chat ID」才能拉取群成员列表'
      }
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
        placeholder={hasChatId ? '从群成员中选择' : '请先选择飞书群 Chat ID'}
        notFoundContent={chatMembersLoading ? '加载中…' : '群内暂无成员'}
        filterOption={(input, opt) => (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())}
        options={chatMembers.map((m) => ({ label: m.name || m.userId, value: m.userId }))}
      />
    </Form.Item>
  )

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
      <Form form={form} layout="vertical" className="pt-2">
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="供应商"
              name="vendorCode"
              tooltip="可不选：不选时该配置只按路由编码匹配运单，不看运单上的承运商"
            >
              <Select
                showSearch
                allowClear
                loading={vendorsLoading}
                placeholder="不选则只按路由编码匹配"
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

        <Row gutter={16}>
          <Col xs={24} sm={12}>
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
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="路由码白名单"
              name="routeCodeWhitelist"
              extra=""
            >
              <Input.TextArea
                rows={4}
                placeholder={'例如：RC001 RC002\n或 RC001，RC002'}
                allowClear
              />
            </Form.Item>
          </Col>
        </Row>

        {secretsVisibility === 'full' ? (
          <>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="飞书群 Chat ID"
                  name="chatId"
                  tooltip="配置后该供应商推送走自建应用机器人发送，支持查看已读情况；前提是该应用机器人已被拉进目标群。与「飞书 webhook」（更多里）至少填写一项"
                >
                  <Select
                    showSearch
                    allowClear
                    loading={botChatsLoading}
                    placeholder="选择机器人所在的群"
                    notFoundContent={botChatsLoading ? '加载中…' : '机器人尚未加入任何群'}
                    filterOption={(input, opt) =>
                      (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={botChats.map((c) => ({
                      label: c.name || `未命名群（${c.chatId}）`,
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
          更多
        </Button>

        {moreOpen ? (
          <div className="space-y-4">
            {secretsVisibility === 'full' ? (
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item label="飞书 webhook" name="webhookUrl" rules={webhookFieldRules(false)}>
                    <Input placeholder={FEISHU_WEBHOOK_PREFIX} allowClear />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item label="飞书 webhook 密钥" name="signingSecret">
                    <Input.Password placeholder="可选；若群机器人开启签名校验则必填" autoComplete="new-password" />
                  </Form.Item>
                </Col>
              </Row>
            ) : null}

            <Form.Item
              label="所属站点编码"
              name="stationCode"
              tooltip="该供应商固定归属的站点，供司机地图等按站点轮询的功能使用；可选"
            >
              <Select
                allowClear
                showSearch
                loading={stationsLoading}
                placeholder="选择站点"
                filterOption={(input, opt) =>
                  (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={stations.map((s) => ({ label: s.label, value: s.value }))}
              />
            </Form.Item>

            <Form.Item
              label="供应商推送内容"
              name="pushContent"
              extra=""
            >
              <FeishuLarkMdEditor rows={5} placeholder="例如：【货量日报】以下为按邮编/城市汇总单量。" />
            </Form.Item>
          </div>
        ) : null}
      </Form>
    </Modal>
  )
}
