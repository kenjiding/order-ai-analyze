import { adminColors } from '../../../theme/adminColors'

type Props = {
  count: number
  pct: number
  /**
   * 条形实际宽度用的百分比，默认等于 pct。区间占总件数往往不到 1%，直接按 pct 画条
   * 会细到看不见；调用方可以按"同一列里最大 pct = 100%"算出 barWidthPct 传进来，
   * 让条形在列内可比，不代表真实占比（真实占比仍然看旁边的文字）。
   */
  barWidthPct?: number
}

const MIN_VISIBLE_WIDTH = 4

/**
 * 表格单元格内的迷你条形图：件数+占比文字堆在一起不好一眼扫出高低，
 * 加一条填充条，扫表格时先看条长再看数字。
 */
export function MiniBarCell({ count, pct, barWidthPct }: Props) {
  const raw = barWidthPct ?? pct
  const width = count > 0 ? Math.max(MIN_VISIBLE_WIDTH, Math.min(100, raw)) : 0
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="tabular-nums text-sm text-slate-800">
        {count}
        <span className="ml-1 text-xs text-slate-400">({pct.toFixed(1)}%)</span>
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--admin-surface-soft)]">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{ width: `${width}%`, backgroundColor: adminColors.accent }}
        />
      </div>
    </div>
  )
}
