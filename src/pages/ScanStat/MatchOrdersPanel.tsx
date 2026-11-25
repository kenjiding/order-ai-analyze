import { useEffect, useRef, useState } from 'react'
import { Button, Field } from 'react-vant'
import 'react-vant/es/button/style/index.css'
import 'react-vant/es/field/style/index.css'
import type { FieldInstance } from 'react-vant'
import { CheckCircle2, CircleCheck, CircleX, Loader2 } from 'lucide-react'
import { getUserPreference, putUserPreference } from '../../api/userPreferencesApi'
import { matchScanStatPlatform, type ClientCodeBrand } from './scanStatApi'

const MATCH_LIST_PREF_KEY = 'scan-stat-match-list'
const MATCH_PLATFORMS_PREF_KEY = 'scan-stat-match-platforms'

type MatchListValue = { items: string[]; matched: string[] }

type MatchPlatform = Exclude<ClientCodeBrand, 'other'>
const PLATFORM_OPTIONS: { key: MatchPlatform; label: string }[] = [
  { key: 'local', label: '本地件' },
  { key: 'shein', label: 'Shein' },
  { key: 'temu', label: 'Temu' },
]
const PLATFORM_LABEL: Record<ClientCodeBrand, string> = { local: '本地件', shein: 'Shein', temu: 'Temu', other: '其他' }

type PlatformLogEntry = { waybillNo: string; brand: ClientCodeBrand; matched: boolean; found: boolean }

/** 多个订单号用空格/逗号/换行隔开；统一转大写，去重保留输入顺序 */
function parseOrderNos(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of raw.split(/[\s,，]+/)) {
    const no = token.trim().toUpperCase()
    if (!no || seen.has(no)) continue
    seen.add(no)
    out.push(no)
  }
  return out
}

/**
 * 「匹配订单」：PC 端在这里粘贴/输入一批目标订单号并保存，PDA 端扫描比对，
 * 扫到名单里的号就弹 Match 弹层，点 Close 才能继续扫下一个。
 * 目标名单存在 user_preferences（按账号持久化），每次保存整体覆盖（含清空已匹配进度）。
 */
export default function MatchOrdersPanel() {
  const [loading, setLoading] = useState(true)
  const [targetText, setTargetText] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [scanValue, setScanValue] = useState('')
  const [scanHint, setScanHint] = useState('')
  const [modalValue, setModalValue] = useState('')
  const [modalBrand, setModalBrand] = useState<ClientCodeBrand | null>(null)
  const [platforms, setPlatforms] = useState<Set<MatchPlatform>>(new Set())
  const [platformLog, setPlatformLog] = useState<PlatformLogEntry[]>([])
  const [platformMatching, setPlatformMatching] = useState(false)
  const scanRef = useRef<FieldInstance>(null)
  const platformMode = platforms.size > 0

  useEffect(() => {
    let cancelled = false
    void getUserPreference<MatchListValue>(MATCH_LIST_PREF_KEY).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (!res.ok || !res.data.value) return
      const loadedItems = Array.isArray(res.data.value.items) ? res.data.value.items : []
      const loadedMatched = Array.isArray(res.data.value.matched) ? res.data.value.matched : []
      setItems(loadedItems)
      setMatched(new Set(loadedMatched))
      setTargetText(loadedItems.join('\n'))
    })
    void getUserPreference<MatchPlatform[]>(MATCH_PLATFORMS_PREF_KEY).then((res) => {
      if (cancelled) return
      if (!res.ok || !Array.isArray(res.data.value)) return
      setPlatforms(new Set(res.data.value.filter((p): p is MatchPlatform => PLATFORM_OPTIONS.some((o) => o.key === p))))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleTogglePlatform = (key: MatchPlatform) => {
    setPlatforms((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      void putUserPreference<MatchPlatform[]>(MATCH_PLATFORMS_PREF_KEY, [...next])
      return next
    })
  }

  const handleSave = async () => {
    const parsed = parseOrderNos(targetText)
    setSaving(true)
    setSaveMsg('')
    const res = await putUserPreference<MatchListValue>(MATCH_LIST_PREF_KEY, { items: parsed, matched: [] })
    setSaving(false)
    if (!res.ok) {
      setSaveMsg(res.error)
      return
    }
    setItems(parsed)
    setMatched(new Set())
    setSaveMsg(`已保存 ${parsed.length} 个订单号`)
  }

  const handleScanCommit = () => {
    const value = scanValue.trim().toUpperCase()
    setScanValue('')
    if (!value) return
    if (!items.includes(value)) {
      setScanHint(`${value} 未匹配到待匹配名单`)
      return
    }
    setScanHint('')
    setModalBrand(null)
    setModalValue(value)
    if (!matched.has(value)) {
      const next = new Set(matched)
      next.add(value)
      setMatched(next)
      void putUserPreference<MatchListValue>(MATCH_LIST_PREF_KEY, { items, matched: [...next] })
    }
  }

  const handlePlatformScanCommit = async () => {
    const value = scanValue.trim().toUpperCase()
    setScanValue('')
    if (!value || platformMatching) return
    setPlatformMatching(true)
    setScanHint('')
    const res = await matchScanStatPlatform(value)
    setPlatformMatching(false)
    if (!res.ok) {
      setScanHint(res.error)
      return
    }
    const { brand, found } = res.data
    const isMatch = brand !== 'other' && platforms.has(brand)
    setPlatformLog((prev) => [{ waybillNo: value, brand, matched: isMatch, found }, ...prev])
    if (isMatch) {
      setModalBrand(brand)
      setModalValue(value)
    } else if (!found) {
      setScanHint(`${value} 未查到运单`)
    } else {
      setScanHint(`${value} 是「${PLATFORM_LABEL[brand]}」，未命中勾选的平台`)
    }
  }

  const handleModalClose = () => {
    setModalValue('')
    setModalBrand(null)
  }

  // 扫描框的 disabled 要等这次状态更新渲染完才会摘掉，弹层关闭时在 handler 里同步调用 focus() 对着的还是禁用态的输入框，
  // 聚焦不会生效；放到 effect 里在 DOM 更新之后再聚焦才有效。
  useEffect(() => {
    if (!modalValue) scanRef.current?.focus()
  }, [modalValue])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-hidden strokeWidth={2} />
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm shadow-blue-900/5">
        <span className="text-xs font-medium text-zinc-600">按平台匹配（勾选后扫描直接判断包裹平台，忽略下方订单号名单）</span>
        <div className="flex gap-2">
          {PLATFORM_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleTogglePlatform(opt.key)}
              className={
                platforms.has(opt.key)
                  ? 'flex-1 rounded-lg border border-blue-600 bg-blue-50 py-1.5 text-xs font-semibold text-blue-700'
                  : 'flex-1 rounded-lg border border-zinc-200 py-1.5 text-xs font-medium text-zinc-500'
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!platformMode && (
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm shadow-blue-900/5">
          <span className="text-xs font-medium text-zinc-600">待匹配订单号（空格/逗号/换行隔开）</span>
          <textarea
            className="h-24 w-full resize-none rounded-lg border border-zinc-200 p-2 font-mono text-xs text-zinc-800 focus:border-blue-600 focus:outline-none"
            placeholder="粘贴或输入订单号"
            value={targetText}
            onChange={(e) => setTargetText(e.target.value)}
          />
          <Button type="primary" block loading={saving} nativeType="button" onClick={() => void handleSave()}>
            {saving ? '保存中...' : `保存订单号（${parseOrderNos(targetText).length}）`}
          </Button>
          {saveMsg ? <p className="text-xs text-zinc-500">{saveMsg}</p> : null}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border-2 border-zinc-200 bg-white focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-100">
        <Field
          ref={scanRef}
          autoFocus
          label="扫描匹配"
          placeholder="扫码或输入订单号"
          value={scanValue}
          onChange={setScanValue}
          disabled={!!modalValue || platformMatching}
          onKeyPress={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
              if (platformMode) void handlePlatformScanCommit()
              else handleScanCommit()
            }
          }}
          style={{ '--rv-field-label-width': '4.5em' } as React.CSSProperties}
        />
      </div>
      {scanHint ? <p className="px-1 text-xs text-amber-700">{scanHint}</p> : null}

      {platformMode ? (
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm shadow-blue-900/5">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5">
            <span className="text-xs font-medium text-zinc-600">本次扫描记录</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
              {platformLog.filter((e) => e.matched).length}/{platformLog.length}
            </span>
          </div>
          {platformLog.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-400">暂无扫描记录</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {platformLog.map((entry, index) => (
                <li
                  key={`${entry.waybillNo}-${index}`}
                  className={
                    entry.matched
                      ? 'flex items-center gap-2 bg-emerald-50 px-3 py-1.5'
                      : 'flex items-center gap-2 px-3 py-1.5'
                  }
                >
                  {entry.matched ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden strokeWidth={2} />
                  ) : (
                    <CircleX className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden strokeWidth={2} />
                  )}
                  <span
                    className={
                      entry.matched
                        ? 'min-w-0 flex-1 truncate font-mono text-sm font-medium text-emerald-700'
                        : 'min-w-0 flex-1 truncate font-mono text-sm text-zinc-800'
                    }
                  >
                    {entry.waybillNo}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">{entry.found ? PLATFORM_LABEL[entry.brand] : '未查到'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm shadow-blue-900/5">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5">
            <span className="text-xs font-medium text-zinc-600">待匹配名单</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
              {matched.size}/{items.length}
            </span>
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-400">暂无待匹配订单号，先在上面保存一批</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {items.map((no) => (
                <li
                  key={no}
                  className={
                    matched.has(no)
                      ? 'flex items-center gap-2 bg-emerald-50 px-3 py-1.5'
                      : 'flex items-center gap-2 px-3 py-1.5'
                  }
                >
                  {matched.has(no) ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden strokeWidth={2} />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span
                    className={
                      matched.has(no)
                        ? 'min-w-0 flex-1 truncate font-mono text-sm font-medium text-emerald-700'
                        : 'min-w-0 flex-1 truncate font-mono text-sm text-zinc-800'
                    }
                  >
                    {no}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modalValue ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
              <CircleCheck className="h-7 w-7 text-emerald-600" aria-hidden strokeWidth={2} />
            </div>
            <p className="text-base font-semibold text-emerald-700">
              Match{modalBrand ? ` · ${PLATFORM_LABEL[modalBrand]}` : ''}
            </p>
            <p className="mt-1 break-all font-mono text-sm text-zinc-600">{modalValue}</p>
            <Button type="primary" block className="mt-4" nativeType="button" onClick={handleModalClose}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
