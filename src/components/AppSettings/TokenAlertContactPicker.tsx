import { Select } from 'antd'
import { useEffect, useState } from 'react'
import {
  fetchFeishuAppBotChats,
  fetchFeishuChatMembers,
  type FeishuBotChatOption,
  type FeishuChatMemberOption,
} from '../../pages/PushNotifications/feishuWebhookTestApi'
import type { TokenAlertContacts } from '../../imile/tokenAlertContacts'
import { showToast } from '../../utils/toast'

type Props = {
  /** 弹窗打开时才拉取群列表，避免设置页未展开就发请求 */
  active: boolean
  value: TokenAlertContacts
  onChange: (next: TokenAlertContacts) => void
}

/**
 * 「token 失效联系人」选择器：选群仅用于拉取成员名单，
 * token 失效时是按 openId 私聊到人，不发群。
 */
export function TokenAlertContactPicker({ active, value, onChange }: Props) {
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
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium text-slate-700">
        飞书群 Chat ID
        <Select
          className="mt-1.5 w-full"
          showSearch
          allowClear
          loading={botChatsLoading}
          placeholder="选择机器人所在的群"
          value={value.chatId || undefined}
          onChange={(chatId?: string) => onChange({ chatId: chatId ?? '', mentions: [] })}
          filterOption={(input, opt) =>
            (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())
          }
          options={botChats.map((c) => ({ label: c.name || c.chatId, value: c.chatId }))}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        接收人
        <Select
          className="mt-1.5 w-full"
          mode="multiple"
          showSearch
          allowClear
          disabled={!hasChatId}
          loading={chatMembersLoading}
          placeholder={hasChatId ? '从群成员中选择' : '请先选择飞书群 Chat ID'}
          notFoundContent={chatMembersLoading ? '加载中…' : '群内暂无成员'}
          value={value.mentions.map((m) => m.openId)}
          onChange={(openIds: string[]) =>
            onChange({
              ...value,
              mentions: openIds.map((openId) => ({
                openId,
                name: chatMembers.find((m) => m.userId === openId)?.name ?? '',
              })),
            })
          }
          filterOption={(input, opt) =>
            (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())
          }
          options={chatMembers.map((m) => ({ label: m.name || m.userId, value: m.userId }))}
        />
      </label>
    </div>
  )
}
