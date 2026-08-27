/**
 * 站点账户的流转通知联系人选择器，与「iMile token 失效通知」同一套做法：
 * 选群只用于拉取成员名单，实际通知按 openId 私聊到人。
 */
import { useEffect, useState } from 'react'
import { Select } from 'antd'
import {
  fetchFeishuAppBotChats,
  fetchFeishuChatMembers,
  type FeishuBotChatOption,
  type FeishuChatMemberOption,
} from '../../PushNotifications/feishuWebhookTestApi'
import type { AccountPushNotify } from '../../../containerManagement/pushNotify'
import { showToast } from '../../../utils/toast'

type Props = {
  /** 仅在弹窗打开且通知已启用时才拉群列表，避免关着的表单发请求 */
  active: boolean
  disabled: boolean
  value: AccountPushNotify
  onChange: (next: AccountPushNotify) => void
}

export function AccountPushNotifyFields({ active, disabled, value, onChange }: Props) {
  const [botChats, setBotChats] = useState<FeishuBotChatOption[]>([])
  const [botChatsLoading, setBotChatsLoading] = useState(false)
  const [chatMembers, setChatMembers] = useState<FeishuChatMemberOption[]>([])
  const [chatMembersLoading, setChatMembersLoading] = useState(false)

  useEffect(() => {
    if (!active) return
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
  }, [active])

  useEffect(() => {
    const chatId = value.chatId.trim()
    if (!active || !chatId) {
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
  }, [active, value.chatId])

  const hasChatId = Boolean(value.chatId.trim())

  return (
    <div className="space-y-3">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">飞书群</span>
          <Select
            showSearch
            allowClear
            disabled={disabled}
            loading={botChatsLoading}
            placeholder="选择机器人所在的群"
            value={value.chatId || undefined}
            onChange={(chatId?: string) => onChange({ ...value, chatId: chatId ?? '', mentions: [] })}
            filterOption={(input, opt) =>
              (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())
            }
            options={botChats.map((chat) => ({ label: chat.name || chat.chatId, value: chat.chatId }))}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">接收人</span>
          <Select
            mode="multiple"
            showSearch
            allowClear
            disabled={disabled || !hasChatId}
            loading={chatMembersLoading}
            placeholder={hasChatId ? '从群成员中选择' : '请先选择飞书群'}
            notFoundContent={chatMembersLoading ? '加载中…' : '群内暂无成员'}
            value={value.mentions.map((item) => item.openId)}
            onChange={(openIds: string[]) =>
              onChange({
                ...value,
                mentions: openIds.map((openId) => ({
                  openId,
                  name: chatMembers.find((member) => member.userId === openId)?.name ?? '',
                })),
              })
            }
            filterOption={(input, opt) =>
              (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())
            }
            options={chatMembers.map((member) => ({
              label: member.name || member.userId,
              value: member.userId,
            }))}
          />
        </label>
      </div>

      <p className="m-0 text-xs text-slate-500">
        {!value.enabled
          ? '通知已关闭，该站点的流转变更不会推送。'
          : value.mentions.length > 0
            ? `新建流转、差异 / 拒收申报、确认收货、认可实收时私聊 ${value.mentions.length} 人。编辑与删除不推送。`
            : '尚未选择接收人，开启后也不会推送。'}
      </p>
    </div>
  )
}
