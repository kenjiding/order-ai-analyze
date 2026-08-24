import { useState } from 'react'
import { Button, Modal, Select, Typography } from 'antd'
import type { AssignableUser, ContainerAccount } from '../../../containerManagement/types'

type Props = {
  account: ContainerAccount | null
  users: AssignableUser[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (userIds: string[]) => Promise<boolean>
}

export function AccountUserBindingModal({ account, users, submitting, onCancel, onSubmit }: Props) {
  // 由父级用 key 按账户重挂载，初始值直接取当前绑定
  const [selected, setSelected] = useState<string[]>(account?.boundUserIds ?? [])

  return (
    <Modal
      title={account ? `绑定用户 · ${account.name}` : '绑定用户'}
      open={account !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void onSubmit(selected)}>
            保存
          </Button>
        </div>
      }
    >
      <Typography.Paragraph type="secondary" className="mt-4">
        被绑定的用户可以看到该主体的容器台账与流转记录，并能以该主体的身份发起流转、确认收货。
      </Typography.Paragraph>
      <Select
        mode="multiple"
        className="w-full"
        placeholder="选择用户，可搜索"
        value={selected}
        onChange={setSelected}
        allowClear
        optionFilterProp="label"
        options={users.map((user) => ({
          value: user.id,
          label: user.displayName ? `${user.username}（${user.displayName}）` : user.username,
        }))}
      />
    </Modal>
  )
}
