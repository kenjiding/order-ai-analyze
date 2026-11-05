import { Button, Checkbox, Drawer, Select, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { Globe2, Plus, Save, Send, Settings, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { StationMultiSelect } from '../../../components/Layout/StationMultiSelect'
import { useGlobalFilterStore } from '../../../stores/globalFilterStore'
import {
  fetchFeishuAppBotChats,
  fetchFeishuChatMembers,
  type FeishuBotChatOption,
  type FeishuChatMemberOption,
} from '../../PushNotifications/feishuWebhookTestApi'
import { showToast } from '../../../utils/toast'
import { loadRegionOptions } from '../regionClearancePushApi'
import type {
  PushTimeSlot,
  RegionClearancePushSchedule,
  RegionClearancePushScheduleDraft,
  RegionOption,
  StationEntry,
  WeekdayNum,
} from '../regionClearancePushTypes'

const WEEKDAYS: { value: WeekdayNum; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

type Props = {
  open: boolean
  onClose: () => void
  editingSchedule: RegionClearancePushSchedule | null
  saving: boolean
  onSubmit: (draft: RegionClearancePushScheduleDraft) => Promise<boolean>
}

function FormSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--admin-line)] bg-white">
      <header className="flex items-center gap-2.5 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

export function RegionClearancePushScheduleDrawer({ open, onClose, editingSchedule, saving, onSubmit }: Props) {
  const stations = useGlobalFilterStore((s) => s.stations)

  const [regions, setRegions] = useState<RegionOption[]>([])
  const [regionsLoading, setRegionsLoading] = useState(false)
  const [regionCode, setRegionCode] = useState('')
  const [stationCodes, setStationCodes] = useState<string[]>([])
  const [selectedWeekdays, setSelectedWeekdays] = useState<WeekdayNum[]>([])
  const [pushTimes, setPushTimes] = useState<PushTimeSlot[]>([])
  const [chatId, setChatId] = useState('')
  const [mentionOpenIds, setMentionOpenIds] = useState<string[]>([])

  const [botChats, setBotChats] = useState<FeishuBotChatOption[]>([])
  const [botChatsLoading, setBotChatsLoading] = useState(false)
  const [chatMembers, setChatMembers] = useState<FeishuChatMemberOption[]>([])
  const [chatMembersLoading, setChatMembersLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setRegionsLoading(true)
    void loadRegionOptions()
      .then((res) => {
        if (!res.ok) {
          showToast(`加载大区列表失败: ${res.error}`, 'error')
          return
        }
        setRegions(res.data)
      })
      .finally(() => setRegionsLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    setBotChatsLoading(true)
    void fetchFeishuAppBotChats()
      .then((res) => {
        if (!res.ok) {
          showToast(`加载飞书群列表失败: ${res.error}`, 'error')
          return
        }
        setBotChats(res.chats)
      })
      .finally(() => setBotChatsLoading(false))
  }, [open])

  useEffect(() => {
    if (!open || !chatId.trim()) {
      setChatMembers([])
      return
    }
    setChatMembersLoading(true)
    void fetchFeishuChatMembers(chatId)
      .then((res) => {
        if (!res.ok) {
          showToast(`加载群成员失败: ${res.error}`, 'error')
          return
        }
        setChatMembers(res.members)
      })
      .finally(() => setChatMembersLoading(false))
  }, [open, chatId])

  useEffect(() => {
    if (!open) return
    setRegionCode(editingSchedule?.regionCode ?? '')
    setStationCodes(editingSchedule?.stationCodes.map((s) => s.code) ?? [])
    setSelectedWeekdays(editingSchedule?.weekdays ?? [])
    setPushTimes(editingSchedule?.pushTimes ?? [])
    setChatId(editingSchedule?.chatId ?? '')
    setMentionOpenIds(editingSchedule?.mentionOpenIds.map((m) => m.openId) ?? [])
  }, [open, editingSchedule])

  const handleAddTime = () => setPushTimes((prev) => [...prev, { id: generateId(), time: '09:00' }])
  const handleRemoveTime = (id: string) => setPushTimes((prev) => prev.filter((t) => t.id !== id))
  const handleTimeChange = (id: string, newTime: string) =>
    setPushTimes((prev) => prev.map((t) => (t.id === id ? { ...t, time: newTime } : t)))

  const hasChatId = Boolean(chatId.trim())

  const handleConfirm = async () => {
    const region = regions.find((r) => r.value === regionCode)
    if (!region) {
      showToast('请选择大区', 'error')
      return
    }
    if (stationCodes.length === 0) {
      showToast('请至少选择一个站点', 'error')
      return
    }
    if (selectedWeekdays.length === 0) {
      showToast('请选择推送星期', 'error')
      return
    }
    if (pushTimes.length === 0) {
      showToast('请添加推送时间', 'error')
      return
    }
    if (!chatId.trim()) {
      showToast('请选择推送群', 'error')
      return
    }
    const stationEntries: StationEntry[] = stationCodes.map((code) => ({
      code,
      name: stations.find((s) => s.value === code)?.label ?? code,
    }))
    const draft: RegionClearancePushScheduleDraft = {
      regionCode: region.value,
      regionName: region.label,
      stationCodes: stationEntries,
      weekdays: selectedWeekdays,
      pushTimes,
      isEnabled: true,
      chatId: chatId.trim(),
      mentionOpenIds: mentionOpenIds.map((openId) => ({
        openId,
        name: chatMembers.find((m) => m.userId === openId)?.name ?? '',
      })),
    }
    const ok = await onSubmit(draft)
    if (ok) onClose()
  }

  const regionOptions = useMemo(() => regions.map((r) => ({ label: r.label, value: r.value })), [regions])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={640}
      maskClosable={!saving}
      title={
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          <span>{editingSchedule ? '编辑区域清货数据推送配置' : '新增区域清货数据推送配置'}</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void handleConfirm()}>
            确定
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <FormSection icon={Globe2} title="大区与站点">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">大区选择</span>
              <Select
                showSearch
                value={regionCode || undefined}
                onChange={setRegionCode}
                options={regionOptions}
                loading={regionsLoading}
                disabled={saving}
                placeholder="请选择大区"
                className="w-[220px]"
                optionFilterProp="label"
              />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <span className="mt-1.5 w-16 shrink-0 text-xs font-medium text-slate-500">站点选择</span>
              <StationMultiSelect value={stationCodes} onChange={setStationCodes} disabled={saving} className="min-w-[320px] flex-1" />
            </div>
            <p className="text-xs text-slate-400">
              站点归属不做自动校验，请手动勾选该大区负责的站点；子维度数据按这里勾选的站点聚合。
            </p>
          </div>
        </FormSection>

        <FormSection icon={Settings} title="推送星期与时间">
          <div className="divide-y divide-[var(--admin-line)]">
            <div className="flex items-center gap-4 py-3 first:pt-0">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">推送星期</span>
              <Checkbox.Group
                value={selectedWeekdays}
                disabled={saving}
                onChange={(vals) => setSelectedWeekdays(vals as WeekdayNum[])}
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {WEEKDAYS.map((day) => (
                    <Checkbox key={day.value} value={day.value}>
                      <span className="text-sm">{day.label}</span>
                    </Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </div>

            <div className="flex items-start gap-4 py-3 last:pb-0">
              <span className="mt-1 w-16 shrink-0 text-xs font-medium text-slate-500">推送时间</span>
              <div className="flex flex-wrap items-center gap-2">
                {pushTimes.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center gap-0.5 rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-soft)] pl-1 pr-0.5 transition-colors hover:border-[var(--admin-accent)]/40"
                  >
                    <TimePicker
                      value={dayjs(slot.time, 'HH:mm')}
                      format="HH:mm"
                      minuteStep={5}
                      allowClear={false}
                      variant="borderless"
                      disabled={saving}
                      className="!w-24"
                      onChange={(val) => {
                        if (val) handleTimeChange(slot.id, val.format('HH:mm'))
                      }}
                    />
                    {!saving && (
                      <button
                        onClick={() => handleRemoveTime(slot.id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {!saving && (
                  <Button
                    type="dashed"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={handleAddTime}
                    className="!border-[var(--admin-accent)]/40 !text-xs !text-[var(--admin-accent)] hover:!border-[var(--admin-accent)] hover:!bg-[var(--admin-accent-soft)]"
                  >
                    添加
                  </Button>
                )}
                {pushTimes.length === 0 && <span className="text-xs text-slate-400">暂无推送时间</span>}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection icon={Send} title="推送群与@人">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-500">推送群</span>
              <Select
                showSearch
                allowClear
                value={chatId || undefined}
                onChange={(v) => setChatId(v ?? '')}
                loading={botChatsLoading}
                placeholder="选择机器人所在的群"
                notFoundContent={botChatsLoading ? '加载中...' : '机器人未加入任何群'}
                filterOption={(input, opt) => (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())}
                options={botChats.map((c) => ({ label: c.name || `未命名群(${c.chatId})`, value: c.chatId }))}
                className="w-full"
                disabled={saving}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-500">@ 相关人员</span>
              <Select
                mode="multiple"
                showSearch
                allowClear
                disabled={!hasChatId || saving}
                loading={chatMembersLoading}
                value={mentionOpenIds}
                onChange={setMentionOpenIds}
                placeholder={hasChatId ? '选择要 @ 的人员' : '请先选择推送群'}
                notFoundContent={chatMembersLoading ? '加载中...' : '未找到群成员'}
                filterOption={(input, opt) => (opt?.label ? String(opt.label) : '').toLowerCase().includes(input.toLowerCase())}
                options={chatMembers.map((m) => ({ label: m.name || m.userId, value: m.userId }))}
                className="w-full"
              />
            </div>
          </div>
        </FormSection>
      </div>
    </Drawer>
  )
}
