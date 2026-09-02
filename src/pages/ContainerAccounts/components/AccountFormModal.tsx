/**
 * 站点账户表单：基本信息、绑定用户、流转通知三段一次提交，
 * 后端在同一个事务里落库，不会出现「建好了账户但没绑上人」的中间态。
 *
 * 版式与「新增流转记录」保持一致：浅蓝弹窗底 + 白色分段卡片，字段手写 label，
 * 校验统一走底部 Alert，不引入第二套 Form.Item 观感。
 */
import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Switch } from 'antd'
import {
  ACCOUNT_KINDS,
  accountKindLabel,
  defaultIsExternal,
} from '../../../containerManagement/constants'
import {
  DEFAULT_ACCOUNT_PUSH_NOTIFY,
  type AccountPushNotify,
} from '../../../containerManagement/pushNotify'
import type { AccountKind, AssignableUser, ContainerAccount } from '../../../containerManagement/types'
import type { AccountDraft } from '../useContainerAccountsPage'
import { AccountPushNotifyFields } from './AccountPushNotifyFields'

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--admin-line)] bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-2">
        <span className="text-sm font-semibold text-slate-800">{title}</span>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="text-sm text-slate-700">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  )
}

type Props = {
  open: boolean
  editing: ContainerAccount | null
  users: AssignableUser[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (draft: AccountDraft) => Promise<boolean>
}

export function AccountFormModal({ open, editing, users, submitting, onCancel, onSubmit }: Props) {
  const isEditing = editing !== null
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('CUSTOMER')
  const [isExternal, setIsExternal] = useState(false)
  /** 用户手动动过开关后就别再跟着类型跑，否则他改一下类型勾选被无声冲掉 */
  const [externalTouched, setExternalTouched] = useState(false)
  const [userIds, setUserIds] = useState<string[]>([])
  const [pushNotify, setPushNotify] = useState<AccountPushNotify>(DEFAULT_ACCOUNT_PUSH_NOTIFY)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setKind(editing?.kind ?? 'CUSTOMER')
    setIsExternal(editing ? editing.isExternal : defaultIsExternal('CUSTOMER'))
    setExternalTouched(false)
    setUserIds(editing?.boundUserIds ?? [])
    setPushNotify(editing?.pushNotify ?? DEFAULT_ACCOUNT_PUSH_NOTIFY)
    setError(null)
  }, [open, editing])

  const handleOk = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请填写站点名称')
      return
    }
    if (trimmed.length > 200) {
      setError('站点名称最长 200 字')
      return
    }
    setError(null)
    await onSubmit({ name: trimmed, kind, isExternal, userIds, pushNotify })
  }

  return (
    <Modal
      title={isEditing ? '编辑站点账户' : '新增站点账户'}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={720}
      styles={{ body: { background: 'var(--admin-bg, #f7fbff)', padding: '16px 24px' } }}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {isEditing
              ? '绑定用户为全量覆盖，保存后立即生效。'
              : '绑定用户与通知配置随站点一起创建，任一环节失败则整体不创建。'}
          </span>
          <div className="flex gap-2">
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
              {isEditing ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Section title="基本信息">
          <div className="grid gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-2">
            <Field label="名称" required>
              <Input
                placeholder="例如：墨尔本一号仓"
                allowClear
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (error) setError(null)
                }}
              />
            </Field>
            <Field label="类型" required>
              <Select
                value={kind}
                onChange={(next) => {
                  setKind(next)
                  if (!externalTouched) setIsExternal(defaultIsExternal(next))
                }}
                options={ACCOUNT_KINDS.map((item) => ({
                  value: item,
                  label: accountKindLabel[item],
                }))}
              />
            </Field>
            <div className="sm:col-span-2">
              <div className="flex items-start gap-3 rounded-lg bg-[var(--admin-surface-soft)] px-3 py-2.5">
                <Switch
                  className="mt-0.5 shrink-0"
                  checked={isExternal}
                  onChange={(next) => {
                    setIsExternal(next)
                    setExternalTouched(true)
                  }}
                />
                <div className="min-w-0">
                  <div className="text-sm text-slate-800">该站点方没有本系统账号</div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section title="绑定用户">
          <div className="px-4 py-4">
            <Field
              label="可操作该站点的用户"
              hint={
                userIds.length > 0
                  ? `已选 ${userIds.length} 人。被绑定的用户能看到该站点的台账与流转，并可以该站点身份发起流转、确认收货。`
                  : '未绑定时，只有超级管理员能看到该站点。'
              }
            >
              <Select
                mode="multiple"
                placeholder="选择用户，可搜索"
                value={userIds}
                onChange={setUserIds}
                allowClear
                optionFilterProp="label"
                options={users.map((user) => ({
                  value: user.id,
                  label: user.displayName ? `${user.username}（${user.displayName}）` : user.username,
                }))}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="流转通知"
          action={
            <Switch
              checked={pushNotify.enabled}
              onChange={(enabled) => setPushNotify((prev) => ({ ...prev, enabled }))}
            />
          }
        >
          <div className="px-4 py-4">
            <AccountPushNotifyFields
              active={open && pushNotify.enabled}
              disabled={!pushNotify.enabled}
              value={pushNotify}
              onChange={setPushNotify}
            />
          </div>
        </Section>

        {error ? <Alert type="error" showIcon message={error} /> : null}
      </div>
    </Modal>
  )
}
