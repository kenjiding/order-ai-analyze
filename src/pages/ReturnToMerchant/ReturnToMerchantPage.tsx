import { useMemo, useRef, useState } from 'react'
import { Button, Field } from 'react-vant'
import 'react-vant/es/button/style/index.css'
import 'react-vant/es/field/style/index.css'
import 'react-vant/es/loading/style/index.css'
import 'react-vant/es/overlay/style/index.css'
import 'react-vant/es/popup/style/index.css'
import type { FieldInstance } from 'react-vant'
import { Select } from 'antd'
import {
  Camera,
  ChevronDown,
  CircleCheck,
  CircleX,
  Loader2,
  LogOut,
  Menu,
  PackageCheck,
  ScanLine,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { GlobalCountrySelector } from '../../components/Layout/GlobalCountrySelector'
import { GlobalStationSelector } from '../../components/Layout/GlobalStationSelector'
import { useGlobalStationBootstrap } from '../../components/Layout/useGlobalStationBootstrap'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { RETURN_MERCHANTS, returnMerchantLabel } from '../../../shared/returnToMerchant/merchants'
import { CameraScanner, type CameraDetectOutcome } from './CameraScanner'
import { MerchantPickerSheet } from './MerchantPickerSheet'
import { submitReturnToMerchant } from './returnToMerchantApi'

type ScanRowStatus = 'pending' | 'submitting' | 'success' | 'failed'

type ScanRow = {
  id: string
  scanNumber: string
  clientCode: string
  status: ScanRowStatus
  operateTypeDesc?: string
  blockInfo?: string
  error?: string
}

type SubmitSummary = { total: number; successCount: number }

const MERCHANT_OPTIONS = RETURN_MERCHANTS.map((m) => ({
  label: `${m.label}（${m.clientCode}）`,
  value: m.clientCode,
}))

function newRowId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ReturnToMerchantPage({
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
  const stationLabel = stations.find((s) => s.value === stationCode)?.label ?? stationCode

  const [clientCode, setClientCode] = useState(RETURN_MERCHANTS[0]!.clientCode)
  const [inputValue, setInputValue] = useState('')
  const [rows, setRows] = useState<ScanRow[]>([])
  const [scanHint, setScanHint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [summary, setSummary] = useState<SubmitSummary | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  /**
   * 商家选择面板：整页只挂一个，不给每行都塞一个 Popup。
   * 关闭只翻 open，rowId 留到下次打开才覆盖 —— 否则退场动画期间面板内容会先空掉闪一下。
   */
  const [merchantSheet, setMerchantSheet] = useState({ open: false, rowId: '' })
  const inputRef = useRef<FieldInstance>(null)

  /** 已完结的不再重复提交；待提交与失败的一起走批量 */
  const submittableRows = useMemo(
    () => rows.filter((r) => r.status === 'pending' || r.status === 'failed'),
    [rows],
  )
  const sheetRow = rows.find((r) => r.id === merchantSheet.rowId) ?? null
  const closeMerchantSheet = () => setMerchantSheet((prev) => ({ ...prev, open: false }))

  const successCount = rows.filter((r) => r.status === 'success').length
  const failedCount = rows.filter((r) => r.status === 'failed').length

  /** 扫码枪回车与摄像头识别共用的入列逻辑；结果交给调用方决定怎么提示 */
  const addScanNumber = (raw: string): CameraDetectOutcome => {
    const scanNumber = raw.trim()
    if (!scanNumber) return 'empty'
    // 同一条码重复扫会造成重复完结，交给调用方明确提示而不是静默忽略
    if (rows.some((r) => r.scanNumber === scanNumber)) return 'duplicate'
    setRows((prev) => [{ id: newRowId(), scanNumber, clientCode, status: 'pending' }, ...prev])
    return 'added'
  }

  const handleCommitScan = () => {
    const scanNumber = inputValue.trim()
    setInputValue('')
    const outcome = addScanNumber(scanNumber)
    setScanHint(outcome === 'duplicate' ? `${scanNumber} 已在列表中，未重复添加` : '')
  }

  const handleRemove = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  /** 改商家等于换了一组参数，已出的结果作废，回到待提交 */
  const handleChangeRowMerchant = (id: string, nextClientCode: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              clientCode: nextClientCode,
              status: 'pending',
              operateTypeDesc: undefined,
              blockInfo: undefined,
              error: undefined,
            }
          : r,
      ),
    )
  }

  const handleClearFinished = () => {
    setRows((prev) => prev.filter((r) => r.status !== 'success'))
  }

  const handleSubmit = async () => {
    if (submittableRows.length === 0 || !stationCode || !imileToken.trim()) return
    const submittingIds = new Set(submittableRows.map((r) => r.id))
    setSubmitting(true)
    setErrorMsg('')
    setSummary(null)
    setRows((prev) =>
      prev.map((r) => (submittingIds.has(r.id) ? { ...r, status: 'submitting' } : r)),
    )

    const res = await submitReturnToMerchant({
      imileToken,
      stationCode,
      items: submittableRows.map((r) => ({
        id: r.id,
        scanNumber: r.scanNumber,
        clientCode: r.clientCode,
      })),
    })
    setSubmitting(false)

    if (!res.ok) {
      if (res.unauthorized) {
        onUnauthorized()
        return
      }
      // 整批请求失败：把本批打回失败态，错误原因统一挂在顶部，避免每行重复同一句话
      setErrorMsg(res.error)
      setRows((prev) =>
        prev.map((r) => (submittingIds.has(r.id) ? { ...r, status: 'failed', error: res.error } : r)),
      )
      return
    }

    const resultById = new Map(res.data.results.map((item) => [item.id, item]))
    setRows((prev) =>
      prev.map((r) => {
        const result = resultById.get(r.id)
        if (!result) return r
        return result.ok
          ? {
              ...r,
              status: 'success',
              operateTypeDesc: result.operateTypeDesc,
              blockInfo: result.blockInfo,
              error: undefined,
            }
          : { ...r, status: 'failed', error: result.error || '提交失败', operateTypeDesc: undefined, blockInfo: undefined }
      }),
    )
    setSummary({ total: res.data.total, successCount: res.data.successCount })
    inputRef.current?.focus()
  }

  const disabledReason = !stationCode
    ? '请先在右上角菜单中选择责任站点'
    : !imileToken.trim()
      ? '请先在电脑端「系统设置」中配置 iMile Token'
      : submittableRows.length === 0
        ? '没有待完结的条码'
        : ''

  return (
    <div
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-slate-50 via-white to-[#e1f5f1]/50 text-zinc-900"
      style={{ '--rv-primary-color': '#1f6f68' } as React.CSSProperties}
    >
      {/* 固定装饰光晕：不随内容滚动，负 z-index 保证不挡遮罩点击 */}
      <div
        className="pointer-events-none fixed -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-[#2f8f87]/15 blur-3xl"
        aria-hidden
      />

      {/* 顶部栏：标题 + 当前站点 + 菜单入口，固定高度单行不换行 */}
      <header className="z-20 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-zinc-200/80 bg-white/90 px-2.5 backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#1f6f68] shadow-sm shadow-[#1f6f68]/30">
            <PackageCheck className="h-3.5 w-3.5 text-white" aria-hidden strokeWidth={2} />
          </span>
          <span className="shrink-0 text-sm font-semibold text-zinc-900">退返商家完结</span>
          {stationCode ? (
            <span className="min-w-0 truncate rounded-full bg-[#e1f5f1] px-2 py-0.5 text-[11px] font-medium text-[#1f6f68]">
              {stationLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:scale-[0.97] active:bg-[#e1f5f1] active:text-[#1f6f68]"
        >
          {menuOpen ? (
            <X className="h-4.5 w-4.5" aria-hidden strokeWidth={2} />
          ) : (
            <Menu className="h-4.5 w-4.5" aria-hidden strokeWidth={2} />
          )}
        </button>
      </header>

      {/* 移动端下拉菜单：国家 / 责任站点 + 当前用户登出 */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
          <div className="fixed right-2.5 top-11 z-30 w-60 space-y-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg shadow-[#1f6f68]/10">
            <div className="h-1 bg-[#1f6f68]" aria-hidden />
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

      {settingsLoaded && !imileToken.trim() && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-2.5 py-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden strokeWidth={2} />
          <span className="text-xs font-medium text-amber-700">
            未配置 iMile Token，请在电脑端「系统设置」中配置
          </span>
        </div>
      )}

      {/* 主体：扫描台 + 待完结列表，底部留白避免被固定操作栏遮挡 */}
      <main className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5 pt-2.5">
        {!stationCode && (
          <div className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            请先点击右上角菜单选择责任站点
          </div>
        )}

        {/* 扫描台：页面的操作重心，用实心色带 + 加粗描边把它和下面的列表区分开 */}
        <section className="overflow-hidden rounded-xl border-2 border-[#2f8f87]/35 bg-white shadow-sm shadow-[#1f6f68]/5">
          <div className="flex items-center gap-1.5 bg-[#1f6f68] px-3 py-1.5">
            <ScanLine className="h-3.5 w-3.5 text-white" aria-hidden strokeWidth={2} />
            <span className="text-xs font-semibold text-white">扫描台</span>
          </div>
          <div className="space-y-2 p-3">
            <div className="space-y-1">
              <label htmlFor="rtm-merchant" className="block text-xs font-medium text-zinc-600">
                商家
              </label>
              <Select
                id="rtm-merchant"
                className="w-full"
                value={clientCode}
                onChange={setClientCode}
                options={MERCHANT_OPTIONS}
                disabled={!stationCode}
              />
              <p className="text-[11px] text-zinc-400">扫码后按此商家入列，入列后仍可逐条改</p>
            </div>

            <div className="space-y-1">
              <span className="block text-xs font-medium text-zinc-600">条形码</span>
              <div className="flex items-center overflow-hidden rounded-xl border-2 border-zinc-200 bg-white focus-within:border-[#2f8f87] focus-within:ring-4 focus-within:ring-[#e1f5f1]">
                <div className="min-w-0 flex-1">
                  <Field
                    ref={inputRef}
                    autoFocus
                    clearable
                    placeholder="扫码枪扫描或手动输入条形码"
                    value={inputValue}
                    onChange={setInputValue}
                    disabled={!stationCode}
                    onKeyPress={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter') handleCommitScan()
                    }}
                    style={
                      {
                        '--rv-field-input-text-color': '#223247',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '17px',
                        letterSpacing: '0.02em',
                      } as React.CSSProperties
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={!stationCode}
                  aria-label="用摄像头扫码"
                  className="flex h-11 w-12 shrink-0 items-center justify-center border-l border-zinc-200 text-[#1f6f68] active:scale-[0.97] active:bg-[#e1f5f1] disabled:text-zinc-300"
                >
                  <Camera className="h-5 w-5" aria-hidden strokeWidth={2} />
                </button>
              </div>
              {scanHint && (
                <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
                  <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden strokeWidth={2} />
                  {scanHint}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white shadow-sm shadow-[#1f6f68]/5">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-1.5">
            <span className="text-xs font-medium text-zinc-600">待完结</span>
            <div className="flex items-center gap-2">
              {successCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFinished}
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-500 active:scale-[0.97] active:bg-zinc-100"
                >
                  清除已完结（{successCount}）
                </button>
              )}
              <span className="rounded-full bg-[#e1f5f1] px-2 py-0.5 font-mono text-xs font-semibold text-[#1f6f68]">
                {rows.length}
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e1f5f1]">
                <ScanLine className="h-5 w-5 text-[#2f8f87]" aria-hidden strokeWidth={1.5} />
              </span>
              <p className="text-xs text-zinc-400">先选商家，再扫条形码（或点相机用摄像头识别），可连续扫多组一起完结</p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <li key={row.id} className={`border-l-2 px-2.5 py-1.5 ${rowToneClass(row.status)}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-800">
                      {row.scanNumber}
                    </span>
                    <MerchantTrigger
                      clientCode={row.clientCode}
                      disabled={row.status === 'submitting'}
                      onClick={() => setMerchantSheet({ open: true, rowId: row.id })}
                    />
                    <StatusMark status={row.status} />
                    <button
                      type="button"
                      disabled={row.status === 'submitting'}
                      onClick={() => handleRemove(row.id)}
                      aria-label={`删除 ${row.scanNumber}`}
                      className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-500 active:scale-[0.97] active:bg-red-50 active:text-red-700 disabled:text-red-200"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden strokeWidth={2} />
                    </button>
                  </div>
                  {/* 第二行只在有结果要说时才占位，待完结的行保持单行高度 */}
                  {row.status === 'success' && (row.operateTypeDesc || row.blockInfo) && (
                    <p className="truncate text-[11px] leading-tight text-emerald-700">
                      {row.operateTypeDesc}
                      {row.blockInfo && (
                        <span className="text-amber-700">
                          {row.operateTypeDesc ? ' · ' : ''}
                          {row.blockInfo}
                        </span>
                      )}
                    </p>
                  )}
                  {row.status === 'failed' && row.error && (
                    <p className="break-all text-[11px] leading-tight text-red-600">{row.error}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {errorMsg && (
          <div className="flex items-start gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            <CircleX className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            {errorMsg}
          </div>
        )}

        {summary && (
          <div className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium ${summaryToneClass(summary)}`}>
            {summary.successCount === summary.total ? (
              <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            )}
            本次提交 {summary.total} 组，成功 {summary.successCount} 组，失败{' '}
            {summary.total - summary.successCount} 组
          </div>
        )}
      </main>

      {/* 底部固定操作栏：flex 底栏 + 视口高度锁定，不随列表滚动 */}
      <div className="z-20 shrink-0 border-t border-zinc-200/80 bg-white/95 px-2.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur-sm">
        <Button
          type="primary"
          block
          loading={submitting}
          disabled={!!disabledReason}
          onClick={() => void handleSubmit()}
          nativeType="button"
        >
          {submitting
            ? '完结中...'
            : failedCount > 0
              ? `重试并完结（${submittableRows.length}）`
              : `批量完结（${submittableRows.length}）`}
        </Button>
        {disabledReason && !submitting && (
          <p className="pt-1 text-center text-[11px] text-zinc-400">{disabledReason}</p>
        )}
      </div>

      <MerchantPickerSheet
        visible={merchantSheet.open}
        scanNumber={sheetRow?.scanNumber ?? ''}
        clientCode={sheetRow?.clientCode ?? ''}
        onSelect={(next) => {
          handleChangeRowMerchant(merchantSheet.rowId, next)
          closeMerchantSheet()
        }}
        onClose={closeMerchantSheet}
      />

      {cameraOpen && (
        <CameraScanner
          merchantLabel={returnMerchantLabel(clientCode)}
          onDetect={addScanNumber}
          onClose={() => {
            setCameraOpen(false)
            inputRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function rowToneClass(status: ScanRowStatus): string {
  if (status === 'success') return 'border-emerald-500'
  if (status === 'failed') return 'border-red-500 bg-red-50/50'
  if (status === 'submitting') return 'border-[#2f8f87]'
  return 'border-transparent'
}

function summaryToneClass(summary: SubmitSummary): string {
  if (summary.successCount === summary.total) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (summary.successCount === 0) return 'border-red-200 bg-red-50 text-red-700'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

/** 行内商家触发器：点开页级 ActionSheet 选择。定宽避免不同商家名导致条码列宽度跳动 */
function MerchantTrigger({
  clientCode,
  disabled,
  onClick,
}: {
  clientCode: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`商家 ${returnMerchantLabel(clientCode)}，点击切换`}
      className="flex h-7 w-[4.75rem] shrink-0 items-center justify-between gap-1 rounded-md border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 active:scale-[0.97] active:border-[#2f8f87] active:bg-[#e1f5f1] disabled:text-zinc-400"
    >
      <span className="truncate">{returnMerchantLabel(clientCode)}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden strokeWidth={2} />
    </button>
  )
}

/** 状态只用一个图标位；「待完结」是默认态不占位，靠左侧色条区分即可 */
function StatusMark({ status }: { status: ScanRowStatus }) {
  if (status === 'success') {
    return (
      <span className="shrink-0">
        <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden strokeWidth={2} />
        <span className="sr-only">已完结</span>
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-red-600">
        <CircleX className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
        失败
      </span>
    )
  }
  if (status === 'submitting') {
    return (
      <span className="shrink-0">
        <Loader2
          className="h-4 w-4 animate-spin text-[#1f6f68] motion-reduce:animate-none"
          aria-hidden
          strokeWidth={2}
        />
        <span className="sr-only">完结中</span>
      </span>
    )
  }
  return null
}
