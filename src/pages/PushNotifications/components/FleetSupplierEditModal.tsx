import type { ModalProps } from 'antd'
import { Button, Col, Form, Input, Modal, Row, Select } from 'antd'
import { Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { webhookFieldRules } from '../pushEntryFormValidators'
import { parseFleetRouteCodes } from '../fleetRouteCodeParse'
import type { FleetSupplierConfig, FleetSupplierConfigDraft } from '../fleetSupplierPushTypes'
import { FEISHU_WEBHOOK_PREFIX } from '../feishuPushTypes'
import { FeishuLarkMdEditor } from '../../../components/FeishuLarkMdEditor'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import type { SupplierMentionContact } from '../../../shared/supplierPushConfig'

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

  useEffect(() => {
    if (!open) return
    if (editing) {
      const base = {
        vendorCode: editing.vendorCode,
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
      const selectedVendor = vendors.find((v) => v.vendorCode === values.vendorCode)
      const base: FleetSupplierConfigDraft = {
        vendorCode: values.vendorCode,
        vendorName: selectedVendor?.vendorNameEn ?? values.vendorCode,
        supplierNickname: values.supplierNickname.trim(),
        routeCode: typeof values.routeCode === 'string' ? values.routeCode.trim() : '',
        routeCodeWhitelist:
          typeof values.routeCodeWhitelist === 'string' ? values.routeCodeWhitelist.trim() : '',
        stationCode: typeof values.stationCode === 'string' ? values.stationCode.trim() : '',
        pushDescription: editing?.pushDescription ?? null,
        pushContent: typeof values.pushContent === 'string' ? values.pushContent : '',
        mentionOpenIds: (Array.isArray(values.mentionOpenIds) ? values.mentionOpenIds : [])
          .map((c) => ({ name: (c?.name ?? '').trim(), openId: (c?.openId ?? '').trim() }))
          .filter((c) => c.openId.length > 0),
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
      <Form form={form} layout="vertical" className="pt-2">
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
              extra="可选。多个编码可用空格、换行、英文逗号或中文逗号分隔。"
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
            <Form.Item label="飞书 webhook" name="webhookUrl" rules={webhookFieldRules()}>
              <Input placeholder={FEISHU_WEBHOOK_PREFIX} allowClear />
            </Form.Item>

            <Form.Item label="飞书 webhook 密钥" name="signingSecret">
              <Input.Password placeholder="可选；若群机器人开启签名校验则必填" autoComplete="new-password" />
            </Form.Item>
          </>
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
          extra="将先于图片以富文本卡片推送至群内；与 Tab 顶部「推送内容」拼接为本条消息正文（本段在上、顶部段在下），任一段可留空。"
        >
          <FeishuLarkMdEditor rows={5} placeholder="例如：【货量日报】以下为按邮编/城市汇总单量。" />
        </Form.Item>

        <Form.Item
          label="@ 外部联系人"
          tooltip="群内需要 @ 的外部联系人花名册，可配置多组；各推送是否实际 @ 由该推送「是否 @ 相关人员」开关决定，命中时取第 1 组"
        >
          <Form.List name="mentionOpenIds">
            {(fields, { add, remove }) => (
              <div className="space-y-2">
                {fields.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <Form.Item {...field} name={[field.name, 'name']} noStyle>
                      <Input placeholder="用户名" className="!w-32" allowClear />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, 'openId']}
                      noStyle
                      rules={[{ required: true, message: '请填写 Open ID' }]}
                    >
                      <Input placeholder="Open ID（ou_ 开头）" allowClear />
                    </Form.Item>
                    <button
                      type="button"
                      onClick={() => remove(field.name)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button
                  type="dashed"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => add({ name: '', openId: '' })}
                >
                  添加联系人
                </Button>
              </div>
            )}
          </Form.List>
        </Form.Item>
      </Form>
    </Modal>
  )
}
