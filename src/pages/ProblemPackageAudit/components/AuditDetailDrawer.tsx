import { Button, Collapse, Drawer, Image, Spin, Tooltip } from 'antd'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ImageOff,
  Loader2,
  MapPin,
  RefreshCw,
  ScanLine,
  Sparkles,
  XCircle,
} from 'lucide-react'
import type { DaCodeAuditEntry, DaCodeItem, ImageAuditResult, PackageAuditEntry } from '../types'

type Props = {
  open: boolean
  daCode: string | null
  entry: DaCodeAuditEntry | null
  onClose: () => void
  onLoadPackages: (daCodeItem: DaCodeItem) => void
  onAnalyzeSingle: (daCode: string, pkgIndex: number) => void
}

// ── Color helpers ──────────────────────────────────────────────────────────

const REASON_COLORS: Record<string, { bg: string; text: string; borderColor: string }> = {
  关门: { bg: '#FAECE7', text: '#993C1D', borderColor: '#D85A30' },
  无人: { bg: '#E6F1FB', text: '#185FA5', borderColor: '#378ADD' },
  地址: { bg: '#EEEDFE', text: '#534AB7', borderColor: '#7F77DD' },
  拒收: { bg: '#FCEBEB', text: '#A32D2D', borderColor: '#E24B4A' },
}

function getReasonColor(reasonDesc: string) {
  for (const [keyword, color] of Object.entries(REASON_COLORS)) {
    if (reasonDesc.includes(keyword)) return color
  }
  return { bg: '#F1EFE8', text: '#5F5E5A', borderColor: '#888780' }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ImageCard({
  url,
  result,
  index,
}: {
  url: string
  result: ImageAuditResult | undefined
  index: number
}) {
  const qualified = result?.qualified

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <Image
          src={url}
          alt={`图片 ${index + 1}`}
          style={{ height: '100%', width: '100%', objectFit: 'cover' }}
          preview={{ mask: '预览' }}
          fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23cbd5e1' d='M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-5 6h10l-3-4-2 2-2-2-3 4z'/%3E%3C%2Fsvg%3E"
        />
        {qualified !== undefined && (
          <div
            className={`absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              qualified ? 'bg-green-700/90 text-white' : 'bg-red-700/90 text-white'
            }`}
          >
            {qualified ? <CheckCircle2 size={9} strokeWidth={2.5} /> : <XCircle size={9} strokeWidth={2.5} />}
            {qualified ? '合格' : '不合格'}
          </div>
        )}
        <div className="absolute bottom-1.5 left-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-black/50 text-[10px] font-bold text-white">
          {index + 1}
        </div>
      </div>

      {result?.imageType && (
        <div className="border-b border-slate-100 bg-white px-2 py-1 text-[11px] text-slate-400">
          {result.imageType}
        </div>
      )}

      {result?.address && (
        <div className="flex items-start gap-1 border-b border-slate-100 bg-slate-50 px-2 py-1">
          <MapPin size={10} className="mt-0.5 shrink-0 text-slate-400" />
          <span className="text-[10px] leading-snug text-slate-500">{result.address}</span>
        </div>
      )}

      {result?.observation && (
        <div className="bg-white px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1">
            <ScanLine size={10} className="text-slate-300" />
            <span className="text-[10px] text-slate-300">AI 观察</span>
          </div>
          <p className="text-[11px] leading-[1.5] text-slate-500">{result.observation}</p>
        </div>
      )}

      {result && !result.qualified && result.reason && (
        <div className="border-t border-red-100 bg-red-50 px-2 py-1.5 text-[11px] leading-snug text-red-700">
          {result.reason}
        </div>
      )}

      {!result && (
        <div className="px-2 py-1.5 text-[11px] text-slate-300">待审核</div>
      )}
    </div>
  )
}

function ReasonTag({ reasonDesc }: { reasonDesc: string }) {
  if (!reasonDesc) return null
  const { bg, text } = getReasonColor(reasonDesc)
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: bg, color: text }}
    >
      {reasonDesc.length > 10 ? reasonDesc.slice(0, 10) + '…' : reasonDesc}
    </span>
  )
}

/** 行内分析按钮，放在 Collapse header 右侧 */
function AnalyzeButton({
  pkg,
  onAnalyze,
}: {
  pkg: PackageAuditEntry
  onAnalyze: () => void
}) {
  const isInFlight = pkg.status === 'loading_detail' || pkg.status === 'analyzing'

  if (isInFlight) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-teal-600">
        <Loader2 size={11} className="animate-spin" />
        {pkg.status === 'loading_detail' ? '载入中…' : 'AI 分析中…'}
      </span>
    )
  }

  if (pkg.status === 'completed') {
    return (
      <Tooltip title="重新用 AI 分析该问题件">
        <button
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          onClick={(e) => { e.stopPropagation(); onAnalyze() }}
        >
          <RefreshCw size={11} />
          重新分析
        </button>
      </Tooltip>
    )
  }

  // pending or error
  return (
    <button
      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-50"
      style={{ border: '0.5px solid #99d5cf' }}
      onClick={(e) => { e.stopPropagation(); onAnalyze() }}
    >
      <Sparkles size={11} />
      {pkg.status === 'error' ? '重试' : 'AI 分析'}
    </button>
  )
}

function PackagePanel({ pkg }: { pkg: PackageAuditEntry }) {
  const detail = pkg.detail
  const result = pkg.auditResult
  const isLoading = pkg.status === 'loading_detail' || pkg.status === 'analyzing'

  const accentColor = detail?.problemReasonDesc
    ? getReasonColor(detail.problemReasonDesc).borderColor
    : '#888780'

  return (
    <div className="space-y-3 p-3">
      {/* Problem info */}
      {detail && (detail.problemReasonDesc || detail.problemRemark) && (
        <div
          className="rounded-r-lg bg-slate-50 px-3 py-2.5"
          style={{ borderLeft: `3px solid ${accentColor}` }}
        >
          {detail.problemReasonDesc && (
            <div className="mb-1.5 flex items-start gap-2">
              <span className="mt-0.5 w-[52px] shrink-0 text-[11px] text-slate-400">问题原因</span>
              <span className="text-[13px] font-medium text-slate-700">{detail.problemReasonDesc}</span>
            </div>
          )}
          {detail.problemRemark && (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-[52px] shrink-0 text-[11px] text-slate-400">派件描述</span>
              <span className="text-[12px] italic leading-relaxed text-slate-500">{detail.problemRemark}</span>
            </div>
          )}
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 text-[13px] text-slate-400">
          <Loader2 size={13} className="animate-spin" />
          {pkg.status === 'loading_detail' ? '载入图片中…' : 'AI 识别中…'}
        </div>
      )}

      {/* Error */}
      {pkg.status === 'error' && (
        <p className="text-[13px] text-red-500">错误：{pkg.error}</p>
      )}

      {/* No images */}
      {pkg.status === 'completed' && (!detail?.images || detail.images.length === 0) && (
        <div className="flex items-center gap-2 text-[13px] text-slate-400">
          <ImageOff size={14} />
          该问题件未上传图片
        </div>
      )}

      {/* Overall verdict */}
      {result && (
        <div className="space-y-1.5">
          <div
            className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
              result.overallQualified
                ? 'border border-green-200 bg-green-50'
                : 'border border-red-200 bg-red-50'
            }`}
          >
            {result.overallQualified
              ? <CheckCircle2 size={15} className="shrink-0 text-green-600" />
              : <XCircle size={15} className="shrink-0 text-red-600" />}
            <span className={`text-[13px] font-medium ${result.overallQualified ? 'text-green-700' : 'text-red-700'}`}>
              整体{result.overallQualified ? '合格' : '不合格'}
            </span>
            {result.imageResults.length > 0 && (
              <span className="ml-auto text-[11px] text-slate-400">
                {result.imageResults.filter((r) => r.qualified).length} / {result.imageResults.length} 张合格
              </span>
            )}
          </div>
          {result.validationErrors && result.validationErrors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
              {result.validationErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
                  <span className="text-[12px] leading-snug text-amber-700">{err}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Image grid */}
      {detail?.images && detail.images.length > 0 && (
        <Image.PreviewGroup>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {detail.images.map((url, i) => (
              <ImageCard
                key={url}
                url={url}
                index={i}
                result={result?.imageResults.find((r) => r.index === i)}
              />
            ))}
          </div>
        </Image.PreviewGroup>
      )}
    </div>
  )
}

// ── Main drawer ────────────────────────────────────────────────────────────

export default function AuditDetailDrawer({
  open,
  daCode,
  entry,
  onClose,
  onLoadPackages,
  onAnalyzeSingle,
}: Props) {
  if (!entry) return null

  const packages = entry.packages
  const completedCount = packages.filter((p) => p.status === 'completed' || p.status === 'error').length

  const collapseItems = packages.map((pkg, i) => {
    const waybillNo = pkg.packageInfo.waybillNo || pkg.packageInfo.dtlCode || `问题件 ${i + 1}`
    const taskId = pkg.packageInfo.taskId
    const reasonDesc =
      pkg.detail?.problemReasonDesc ?? (pkg.packageInfo.problemReason as string | undefined) ?? ''

    return {
      key: taskId,
      label: (
        <div className="flex items-center gap-2 pr-1">
          <span className="font-mono text-[13px] font-medium text-slate-700">{waybillNo}</span>
          <span className="text-[11px] text-slate-400">#{String(taskId)}</span>
          {reasonDesc && <ReasonTag reasonDesc={reasonDesc} />}
          <div className="ml-auto flex items-center gap-2">
            <AnalyzeButton
              pkg={pkg}
              onAnalyze={() => onAnalyzeSingle(daCode!, i)}
            />
          </div>
        </div>
      ),
      children: <PackagePanel pkg={pkg} />,
    }
  })

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-medium text-slate-800">DA 代码详情</span>
          <span className="font-mono text-[13px] text-slate-400">{daCode}</span>
          {packages.length > 0 && (
            <span className="ml-auto text-[12px] font-normal text-slate-400">
              {completedCount} / {packages.length} 已完成
            </span>
          )}
        </div>
      }
      open={open}
      onClose={onClose}
      width={760}
      styles={{
        body: { padding: '12px 16px', backgroundColor: '#f8fafc' },
        header: { borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff' },
      }}
    >
      {/* Loading packages */}
      {entry.loadStatus === 'loading' && (
        <div className="flex h-40 items-center justify-center">
          <Spin tip="载入问题件列表…" />
        </div>
      )}

      {/* Load error */}
      {entry.loadStatus === 'error' && (
        <div className="space-y-3 py-8 text-center">
          <p className="text-[13px] text-red-500">载入失败：{entry.loadError}</p>
          <Button onClick={() => onLoadPackages(entry.daCodeItem)}>重新载入</Button>
        </div>
      )}

      {/* Loaded, no packages */}
      {entry.loadStatus === 'loaded' && packages.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
          <Clock size={28} />
          <p className="text-[13px]">该 DA 代码暂无问题件记录</p>
        </div>
      )}

      {/* Package list with per-item analyze buttons */}
      {entry.loadStatus === 'loaded' && packages.length > 0 && (
        <Collapse
          items={collapseItems}
          defaultActiveKey={packages.length <= 5 ? packages.map((p) => p.packageInfo.taskId) : []}
          expandIcon={({ isActive }) =>
            isActive
              ? <ChevronDown size={14} className="text-slate-400" />
              : <ChevronRight size={14} className="text-slate-400" />
          }
          style={{
            background: 'transparent',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
          className="[&_.ant-collapse-item]:rounded-lg [&_.ant-collapse-item]:border [&_.ant-collapse-item]:border-slate-200 [&_.ant-collapse-item]:bg-white [&_.ant-collapse-header]:!px-3 [&_.ant-collapse-header]:!py-2.5 [&_.ant-collapse-content-box]:!p-0"
        />
      )}

      {/* Idle: not yet loaded — offer to load */}
      {entry.loadStatus === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
          <Clock size={28} />
          <p className="text-[13px]">问题件列表尚未载入</p>
          <Button
            icon={<Sparkles size={13} />}
            style={{ color: '#2f8f87', borderColor: '#2f8f87' }}
            onClick={() => onLoadPackages(entry.daCodeItem)}
          >
            载入问题件列表
          </Button>
        </div>
      )}
    </Drawer>
  )
}
