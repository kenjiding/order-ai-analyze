import { Space, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { STATUS_COLORS, DRIVER_TRAIL_COLORS } from './driverMapConstants'
import type { DriverMapPointStatus } from './driverMapTypes'

function Dot({
  color,
  variant,
}: {
  color: string
  variant: 'solid' | 'ring' | 'numbered'
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: variant === 'ring' ? 'transparent' : color,
        border: `2.5px solid ${color}`,
        boxSizing: 'border-box',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 9,
        fontWeight: 800,
        lineHeight: 1,
      }}
    >
      {variant === 'numbered' ? '1' : null}
    </span>
  )
}

export function DriverMapLegend() {
  return (
    <Space size={16} wrap className="text-xs text-slate-500">
      <Space size={6}>
        <Dot color={STATUS_COLORS.completed} variant="numbered" />
        <span>签收</span>
      </Space>
      <Space size={6}>
        <Dot color={STATUS_COLORS.pending} variant="ring" />
        <span>未签收</span>
      </Space>
      <Space size={6}>
        <Dot color={STATUS_COLORS.problem} variant="numbered" />
        <span>问题件</span>
      </Space>
    </Space>
  )
}

const STATUS_COUNT_ITEMS: Array<{
  key: DriverMapPointStatus
  label: string
  activeClass: string
  idleClass: string
  countClass: string
}> = [
  {
    key: 'completed',
    label: '签收',
    activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-800',
    idleClass: 'border-slate-200 bg-white text-slate-500 hover:border-emerald-300',
    countClass: 'text-emerald-600',
  },
  {
    key: 'pending',
    label: '未签收',
    activeClass: 'border-amber-500 bg-amber-50 text-amber-900',
    idleClass: 'border-slate-200 bg-white text-slate-500 hover:border-amber-300',
    countClass: 'text-amber-600',
  },
  {
    key: 'problem',
    label: '问题件',
    activeClass: 'border-red-500 bg-red-50 text-red-800',
    idleClass: 'border-slate-200 bg-white text-slate-500 hover:border-red-300',
    countClass: 'text-red-600',
  },
]

/** 默认展示未签收 + 问题件（不含签收） */
export const DEFAULT_DRIVER_MAP_STATUS_FILTER: ReadonlySet<DriverMapPointStatus> = new Set([
  'pending',
  'problem',
])

/** 卡片标题右侧：可点击筛选签收 / 未签收 / 问题件 */
export function DriverMapStatusCounts({
  completedCount,
  pendingCount,
  problemCount,
  selected,
  onToggle,
}: {
  completedCount: number
  pendingCount: number
  problemCount: number
  selected: ReadonlySet<DriverMapPointStatus>
  onToggle: (status: DriverMapPointStatus) => void
}) {
  const counts: Record<DriverMapPointStatus, number> = {
    completed: completedCount,
    pending: pendingCount,
    problem: problemCount,
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
      {STATUS_COUNT_ITEMS.map((item) => {
        const active = selected.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(item.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors ${
              active ? item.activeClass : item.idleClass
            }`}
          >
            <span>{item.label}</span>
            <span className={`font-semibold ${active ? item.countClass : 'text-slate-400'}`}>{counts[item.key]}</span>
          </button>
        )
      })}
    </div>
  )
}
