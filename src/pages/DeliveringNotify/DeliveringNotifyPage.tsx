import { useRef, useState } from 'react'
import { Button, Field } from 'react-vant'
import 'react-vant/es/button/style/index.css'
import 'react-vant/es/field/style/index.css'
import type { FieldInstance } from 'react-vant'
import {
  BellRing,
  CircleCheck,
  CircleX,
  LogOut,
  Menu,
  PackageSearch,
  ScanLine,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { GlobalStationSelector } from '../../components/Layout/GlobalStationSelector'
import { useGlobalStationBootstrap } from '../../components/Layout/useGlobalStationBootstrap'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { pushDeliveringNotify, type DeliveringNotifyPushData } from './deliveringNotifyApi'

export default function DeliveringNotifyPage({
  displayName,
  onUnauthorized,
  onLogout,
}: {
  displayName: string
  onUnauthorized: () => void
  onLogout: () => void
}) {
  const { imileToken, settingsLoaded } = useAppSettings()
  // 页面打开即回填上次站点并拉列表；不能只依赖菜单内的 GlobalStationSelector
  useGlobalStationBootstrap()
  const { selectedStations, stations } = useGlobalFilterStore()
  const stationCode = selectedStations[0] ?? ''
  const stationLabel =
    stations.find((s) => s.value === stationCode)?.label ?? stationCode

  const [inputValue, setInputValue] = useState('')
  const [scannedList, setScannedList] = useState<string[]>([])
  const [pushing, setPushing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<DeliveringNotifyPushData | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<FieldInstance>(null)

  const handleCommitScan = () => {
    const value = inputValue.trim()
    setInputValue('')
    if (!value) return
    setScannedList((prev) => (prev.includes(value) ? prev : [value, ...prev]))
  }

  const handleRemove = (no: string) => {
    setScannedList((prev) => prev.filter((item) => item !== no))
  }

  const handlePush = async () => {
    if (scannedList.length === 0 || !stationCode || !imileToken.trim()) return
    setPushing(true)
    setErrorMsg('')
    setResult(null)
    const res = await pushDeliveringNotify({
      imileToken,
      stationCode,
      waybillNos: scannedList,
    })
    setPushing(false)
    if (!res.ok) {
      if (res.unauthorized) {
        onUnauthorized()
        return
      }
      setErrorMsg(res.error)
      return
    }
    setResult(res.data)
    // 已成功推送/已查明归属的单号从列表移除，未查到派送信息的保留以便重试或人工核实
    setScannedList(res.data.unmatchedWaybillNos)
    inputRef.current?.focus()
  }

  const disabledReason = !stationCode
    ? '请先在右上角菜单中选择责任站点'
    : !imileToken.trim()
      ? '请先在电脑端「系统设置」中配置 iMile Token'
      : scannedList.length === 0
        ? '请先扫描运单号'
        : ''

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-slate-50 via-white to-blue-50/40 text-zinc-900">
      {/* 固定装饰光晕：不随内容滚动，仅作背景氛围；负 z-index 确保始终在最底层，不影响遮罩点击关闭 */}
      <div
        className="pointer-events-none fixed -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-blue-400/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed -left-20 top-40 -z-10 h-56 w-56 rounded-full bg-indigo-400/10 blur-3xl"
        aria-hidden
      />

      {/* 顶部栏：标题 + 当前站点 + 菜单入口，固定高度，单行不换行 */}
      <header className="z-20 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-zinc-200/80 bg-white/90 px-2.5 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm shadow-blue-600/30">
            <BellRing className="h-3.5 w-3.5 text-white" aria-hidden strokeWidth={2} />
          </span>
          <span className="shrink-0 text-sm font-semibold text-zinc-900">派送中包裹通知</span>
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
          {menuOpen ? (
            <X className="h-4.5 w-4.5" aria-hidden strokeWidth={2} />
          ) : (
            <Menu className="h-4.5 w-4.5" aria-hidden strokeWidth={2} />
          )}
        </button>
      </header>

      {/* 移动端下拉菜单：责任站点选择 + 当前用户 / 登出，点击顶部图标展开 */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="fixed right-2.5 top-11 z-30 w-60 space-y-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg shadow-blue-900/10">
            <div className="h-1 bg-gradient-to-r from-blue-600 to-indigo-600" aria-hidden />
            <div className="space-y-2 p-2">
              <div className="space-y-1 border-b border-zinc-100 pb-2">
                <span className="block px-1 text-[11px] font-medium text-zinc-400">责任站点</span>
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

      {/* iMile Token 未配置时才提醒；已配置（从系统设置同步而来）则不展示任何 Token UI */}
      {settingsLoaded && !imileToken.trim() && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-2.5 py-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden strokeWidth={2} />
          <span className="text-xs font-medium text-amber-700">
            未配置 iMile Token，请在电脑端「系统设置」中配置
          </span>
        </div>
      )}

      {/* 主体：可滚动，扫描输入 + 列表 + 结果；底部留白避免被固定推送栏遮挡 */}
      <main className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5 pt-2.5">
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
            disabled={!stationCode}
            onKeyPress={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') handleCommitScan()
            }}
            style={{ '--rv-field-label-width': '3.5em' } as React.CSSProperties}
          />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm shadow-blue-900/5">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-1.5">
            <span className="text-xs font-medium text-zinc-600">扫描记录</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
              {scannedList.length}
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
                    onClick={() => handleRemove(no)}
                    aria-label={`删除 ${no}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {errorMsg && (
          <div className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            <CircleX className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            {errorMsg}
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div
              className={
                result.pushResults.length > 0 && result.pushResults.every((r) => r.pushed)
                  ? 'flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800'
                  : 'flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800'
              }
            >
              {result.pushResults.length > 0 && result.pushResults.every((r) => r.pushed) ? (
                <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
              ) : (
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
              )}
              本次共 {result.totalScanned} 件，查到派送信息 {result.matchedCount} 件
            </div>

            {result.pushResults.map((r) => (
              <div
                key={r.vendorCode}
                className={
                  r.pushed
                    ? 'rounded-xl border-l-4 border-emerald-500 bg-white px-3 py-2 shadow-sm'
                    : 'rounded-xl border-l-4 border-red-500 bg-white px-3 py-2 shadow-sm'
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-zinc-800">
                      {r.vendorName}
                      <span className="ml-1 font-mono font-normal text-zinc-400">{r.vendorCode}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{r.waybillCount} 件</p>
                  </div>
                  {r.pushed ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      <CircleCheck className="h-3 w-3" aria-hidden strokeWidth={2} />
                      已推送
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      <CircleX className="h-3 w-3" aria-hidden strokeWidth={2} />
                      失败
                    </span>
                  )}
                </div>
                {!r.pushed && r.error && <p className="mt-1 text-[11px] text-red-600">{r.error}</p>}
                {r.couriers.length > 0 && (
                  <ul className="mt-1.5 space-y-1 border-t border-zinc-100 pt-1.5">
                    {r.couriers.map((c) => (
                      <li key={`${c.courierCode}-${c.courier}`} className="text-[11px] text-zinc-600">
                        <span className="font-medium text-zinc-700">
                          {c.courier || '未知司机'}
                          {c.courierCode ? `（${c.courierCode}）` : ''}
                        </span>
                        <span className="ml-1 font-mono text-zinc-500">{c.waybillNos.join('、')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            {result.noConfigVendors.map((v) => (
              <div key={v.courierVendorCode} className="rounded-xl border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
                <p className="flex items-center gap-1 text-xs font-semibold text-amber-800">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
                  供应商代码 {v.courierVendorCode} 未配置推送群（{v.waybillCount} 件），需人工联系
                </p>
                <ul className="mt-1.5 space-y-1 border-t border-amber-100 pt-1.5">
                  {v.couriers.map((c) => (
                    <li key={`${c.courierCode}-${c.courier}`} className="text-[11px] text-amber-700">
                      <span className="font-medium">
                        {c.courier || '未知司机'}
                        {c.courierCode ? `（${c.courierCode}）` : ''}
                      </span>
                      <span className="ml-1 font-mono">{c.waybillNos.join('、')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {result.unmatchedWaybillNos.length > 0 && (
              <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
                <p className="flex items-center gap-1 text-xs font-semibold text-amber-800">
                  <PackageSearch className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
                  以下运单号未查到派送信息，已保留在列表中，请人工核实
                </p>
                <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-amber-700">
                  {result.unmatchedWaybillNos.join('、')}
                </p>
              </div>
            )}

            {result.notInDeliveryWaybillNos.length > 0 && (
              <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 px-3 py-2">
                <p className="flex items-center gap-1 text-xs font-semibold text-amber-800">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
                  以下包裹的最新状态不是派送中，已跳过推送
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] leading-relaxed text-amber-700">
                  {result.notInDeliveryWaybillNos.map((no) => (
                    <li key={no} className="break-all">
                      {no} 包裹的最新状态不是派送中
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 底部固定操作栏：flex 底栏 + 视口高度锁定，不随列表滚动 */}
      <div className="z-20 shrink-0 border-t border-zinc-200/80 bg-white/95 px-2.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-sm">
        <Button
          type="primary"
          block
          loading={pushing}
          disabled={!!disabledReason}
          onClick={() => void handlePush()}
          nativeType="button"
        >
          {pushing ? '推送中...' : `推送给供应商（${scannedList.length}）`}
        </Button>
      </div>
    </div>
  )
}
