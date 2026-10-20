import { useEffect, useRef, useState } from 'react'
import { Button, Field } from 'react-vant'
import 'react-vant/es/button/style/index.css'
import 'react-vant/es/field/style/index.css'
import type { FieldInstance } from 'react-vant'
import { Select } from 'antd'
import {
  CircleCheck,
  CircleX,
  LogOut,
  Menu,
  ScanLine,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { GlobalCountrySelector } from '../../components/Layout/GlobalCountrySelector'
import { GlobalStationSelector } from '../../components/Layout/GlobalStationSelector'
import { useGlobalStationBootstrap } from '../../components/Layout/useGlobalStationBootstrap'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import {
  fetchFeishuAppBotChats,
  fetchFeishuChatMembers,
  type FeishuBotChatOption,
  type FeishuChatMemberOption,
} from '../PushNotifications/feishuWebhookTestApi'
import { lookupScanStat, sendScanStatNos, type ScanStatGroup } from './scanStatApi'
import MatchOrdersPanel from './MatchOrdersPanel'

const CHAT_KEY = 'scan-stat-chat-id'
const OPEN_KEY = 'scan-stat-open-id'

export default function ScanStatPage({
  displayName,
  onUnauthorized,
  onLogout,
}: {
  displayName: string
  onUnauthorized: () => void
  onLogout: () => void
}) {
  useGlobalStationBootstrap()
  const { selectedStations, stations } = useGlobalFilterStore()
  const stationCode = selectedStations[0] ?? ''
  const stationLabel = stations.find((s) => s.value === stationCode)?.label ?? stationCode

  const [activeTab, setActiveTab] = useState<'scan' | 'match'>('scan')
  const [inputValue, setInputValue] = useState('')
  const [scannedList, setScannedList] = useState<string[]>([])
  const [scanHint, setScanHint] = useState('')
  const [groups, setGroups] = useState<ScanStatGroup[] | null>(null)
  const [lookedUpKey, setLookedUpKey] = useState('')
  const [busy, setBusy] = useState<'lookup' | 'send' | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [chats, setChats] = useState<FeishuBotChatOption[]>([])
  const [chatError, setChatError] = useState('')
  const [chatId, setChatId] = useState('')
  const [members, setMembers] = useState<FeishuChatMemberOption[]>([])
  const [memberError, setMemberError] = useState('')
  const [membersLoading, setMembersLoading] = useState(false)
  const [openId, setOpenId] = useState('')
  const inputRef = useRef<FieldInstance>(null)
  const scanKey = scannedList.join('\n')
  const lookupFresh = groups !== null && lookedUpKey === scanKey
  const recipientName = members.find((m) => m.userId === openId)?.name ?? ''

  useEffect(() => {
    let cancelled = false
    void fetchFeishuAppBotChats().then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setChatError(res.error)
        return
      }
      setChats(res.chats)
      const saved = sessionStorage.getItem(CHAT_KEY) ?? ''
      if (saved && res.chats.some((c) => c.chatId === saved)) setChatId(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!chatId) {
      setMembers([])
      return
    }
    sessionStorage.setItem(CHAT_KEY, chatId)
    let cancelled = false
    setMembersLoading(true)
    setMemberError('')
    void fetchFeishuChatMembers(chatId).then((res) => {
      if (cancelled) return
      setMembersLoading(false)
      if (!res.ok) {
        setMemberError(res.error)
        setMembers([])
        setOpenId('')
        return
      }
      setMembers(res.members)
      const saved = sessionStorage.getItem(OPEN_KEY) ?? ''
      setOpenId((current) => {
        if (current && res.members.some((m) => m.userId === current)) return current
        if (saved && res.members.some((m) => m.userId === saved)) return saved
        return ''
      })
    })
    return () => {
      cancelled = true
    }
  }, [chatId])

  useEffect(() => {
    if (openId) sessionStorage.setItem(OPEN_KEY, openId)
  }, [openId])

  const handleCommitScan = () => {
    const value = inputValue.trim()
    setInputValue('')
    if (!value) return
    setSentTo('')
    setScannedList((prev) => {
      if (prev.includes(value)) {
        setScanHint(`${value} 已在列表中`)
        return prev
      }
      setScanHint('')
      return [value, ...prev]
    })
  }

  const handleLookup = async () => {
    if (scannedList.length === 0 || !stationCode || !openId) return
    setBusy('lookup')
    setErrorMsg('')
    setSentTo('')
    const res = await lookupScanStat({
      stationName: stationLabel,
      waybillNos: scannedList,
      openId,
      recipientName,
    })
    setBusy(null)
    if (!res.ok) {
      if (res.unauthorized) onUnauthorized()
      else setErrorMsg(res.error)
      return
    }
    setGroups(res.data.groups)
    setLookedUpKey(scanKey)
    setSentTo(recipientName || openId)
    inputRef.current?.focus()
  }

  const handleSendNos = async () => {
    if (scannedList.length === 0 || !stationCode || !openId) return
    setBusy('send')
    setErrorMsg('')
    setSentTo('')
    const res = await sendScanStatNos({
      stationName: stationLabel,
      stationCode,
      waybillNos: scannedList,
      openId,
      recipientName,
    })
    setBusy(null)
    if (!res.ok) {
      if (res.unauthorized) onUnauthorized()
      else setErrorMsg(res.error)
      return
    }
    setSentTo(recipientName || openId)
    inputRef.current?.focus()
  }

  const disabledReason = !stationCode
    ? '请先在右上角菜单中选择责任站点'
    : scannedList.length === 0
      ? '请先扫描运单号'
      : !openId
        ? '请选择飞书群和接收人'
        : ''

  const merchantCount = groups?.filter((g) => g.kind === 'merchant').length ?? 0

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-slate-50 via-white to-blue-50/40 text-zinc-900">
      <header className="z-20 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-zinc-200/80 bg-white/90 px-2.5 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm shadow-blue-600/30">
            <ScanLine className="h-3.5 w-3.5 text-white" aria-hidden strokeWidth={2} />
          </span>
          <span className="shrink-0 text-sm font-semibold text-zinc-900">扫描统计</span>
          {stationCode ? (
            <span className="min-w-0 truncate rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              {stationLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:scale-[0.97] active:bg-blue-50 active:text-blue-600"
        >
          {menuOpen ? <X className="h-4 w-4" aria-hidden strokeWidth={2} /> : <Menu className="h-4 w-4" aria-hidden strokeWidth={2} />}
        </button>
      </header>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="fixed right-2.5 top-11 z-30 w-60 space-y-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg shadow-blue-900/10">
            <div className="h-1 bg-gradient-to-r from-blue-600 to-indigo-600" aria-hidden />
            <div className="space-y-2 p-2">
              <div className="space-y-1 border-b border-zinc-100 pb-2">
                <span className="block px-1 text-[11px] font-medium text-zinc-400">国家</span>
                <div className="[&_.ant-select]:w-full">
                  <GlobalCountrySelector />
                </div>
                <span className="block px-1 pt-1 text-[11px] font-medium text-zinc-400">责任站点</span>
                <div className="[&_.ant-select]:w-full">
                  <GlobalStationSelector />
                </div>
              </div>
              <Button
                plain
                block
                icon={<LogOut className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden strokeWidth={2} />}
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">{displayName}</span>
                <span className="shrink-0 text-xs text-zinc-400">退出</span>
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="z-10 flex shrink-0 gap-1 border-b border-zinc-200/80 bg-white px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('scan')}
          className={
            activeTab === 'scan'
              ? 'flex-1 rounded-lg bg-blue-50 py-1.5 text-xs font-semibold text-blue-700'
              : 'flex-1 rounded-lg py-1.5 text-xs font-medium text-zinc-500'
          }
        >
          扫描统计
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('match')}
          className={
            activeTab === 'match'
              ? 'flex-1 rounded-lg bg-blue-50 py-1.5 text-xs font-semibold text-blue-700'
              : 'flex-1 rounded-lg py-1.5 text-xs font-medium text-zinc-500'
          }
        >
          匹配订单
        </button>
      </div>

      {activeTab === 'match' && (
        <main className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-2.5">
          <MatchOrdersPanel />
        </main>
      )}

      <main className={activeTab === 'scan' ? 'min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5 pt-2.5' : 'hidden'}>
        {!stationCode && (
          <div className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            请先点击右上角菜单选择责任站点
          </div>
        )}

        <div className="overflow-hidden rounded-xl border-2 border-zinc-200 bg-white focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-100">
          <Field
            ref={inputRef}
            autoFocus
            label="运单号"
            placeholder="扫码或输入运单号"
            value={inputValue}
            onChange={setInputValue}
            disabled={!stationCode || busy !== null}
            onKeyPress={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') handleCommitScan()
            }}
            style={{ '--rv-field-label-width': '3.5em' } as React.CSSProperties}
          />
        </div>
        {scanHint ? <p className="px-1 text-xs text-amber-700">{scanHint}</p> : null}

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm shadow-blue-900/5">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5">
            <span className="text-xs font-medium text-zinc-600">扫描记录</span>
            <span className="flex items-center gap-2">
              {scannedList.length > 0 && (
                <Button plain onClick={() => setScannedList([])}>
                  清空
                </Button>
              )}
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
                {scannedList.length}
              </span>
            </span>
          </div>
          {scannedList.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50">
                <ScanLine className="h-5 w-5 text-blue-400" aria-hidden strokeWidth={1.5} />
              </span>
              <p className="text-xs text-zinc-400">暂无扫描记录，请扫描运单条码</p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {scannedList.map((no, index) => (
                <li key={no} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-800">{no}</span>
                  <Button
                    plain
                    type="danger"
                    icon={<Trash2 size={14} aria-hidden strokeWidth={2} />}
                    onClick={() => setScannedList((prev) => prev.filter((item) => item !== no))}
                    aria-label={`删除 ${no}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm shadow-blue-900/5">
          <span className="text-xs font-medium text-zinc-600">推送到飞书</span>
          <Select
            className="w-full"
            placeholder="选择飞书群"
            value={chatId || undefined}
            options={chats.map((c) => ({ value: c.chatId, label: c.name || c.chatId }))}
            showSearch
            optionFilterProp="label"
            onChange={(value) => {
              setChatId(value)
              setOpenId('')
            }}
          />
          <Select
            className="w-full"
            placeholder={membersLoading ? '正在加载群成员…' : '选择接收人'}
            value={openId || undefined}
            disabled={!chatId || membersLoading}
            loading={membersLoading}
            options={members.map((m) => ({ value: m.userId, label: m.name || m.userId }))}
            showSearch
            optionFilterProp="label"
            onChange={setOpenId}
          />
          {chatError ? <p className="text-xs text-red-600">{chatError}</p> : null}
          {memberError ? <p className="text-xs text-red-600">{memberError}</p> : null}
          <p className="text-[11px] leading-relaxed text-zinc-400">先选机器人所在的群，再选群里的人。运单号发到对方私聊，不发到群里。</p>
        </div>

        {lookupFresh && groups && (
          <div className="space-y-2">
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">
              共 {scannedList.length} 单，{merchantCount} 个商家
            </div>
            {groups.map((g) => (
              <div
                key={`${g.kind}:${g.clientCode || g.clientName}`}
                className={
                  g.kind === 'merchant'
                    ? 'rounded-xl border-l-4 border-blue-500 bg-white px-3 py-2 shadow-sm'
                    : 'rounded-xl border-l-4 border-amber-500 bg-amber-50 px-3 py-2'
                }
              >
                <p className="flex items-baseline justify-between gap-2 text-xs font-semibold text-zinc-800">
                  <span className="min-w-0 truncate">
                    {g.kind === 'merchant'
                      ? g.clientName && g.clientName !== g.clientCode
                        ? `${g.clientCode} ${g.clientName}`
                        : g.clientCode
                      : g.clientName}
                  </span>
                  <span className="shrink-0 font-mono text-blue-700">{g.waybillNos.length}</span>
                </p>
                <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-zinc-500">{g.waybillNos.join('、')}</p>
              </div>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            <CircleX className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            {errorMsg}
          </div>
        )}
        {sentTo && (
          <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
            <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            已私聊发送给 {sentTo}
          </div>
        )}
      </main>

      {activeTab === 'scan' && (
        <div className="z-20 shrink-0 border-t border-zinc-200/80 bg-white/95 px-2.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-sm">
          {disabledReason ? <p className="mb-1 text-center text-[11px] text-zinc-400">{disabledReason}</p> : null}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              loading={busy === 'lookup'}
              disabled={!!disabledReason || busy !== null}
              nativeType="button"
              onClick={() => void handleLookup()}
            >
              {busy === 'lookup' ? '查询中...' : `查询商家（${scannedList.length}）`}
            </Button>
            <Button
              type="primary"
              className="flex-1"
              loading={busy === 'send'}
              disabled={!!disabledReason || busy !== null}
              nativeType="button"
              onClick={() => void handleSendNos()}
            >
              {busy === 'send' ? '发送中...' : `发送订单号（${scannedList.length}）`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
