export type TrackEvent = {
  content: string
  time: string
  trackStageTx?: string
  trackType?: string
}

/** 用户可选的异常责任范围；退返/暂存等闭环统一归入「暂无异常」子类型。 */
export const LOSS_SCOPE_OPTIONS = ['库内丢失', '库外丢失', '3PL丢件', '虚假转运'] as const
export type ConcreteLossScope = (typeof LOSS_SCOPE_OPTIONS)[number]

/** 含「未知」用于历史或未标注数据；已从 IndexedDB 读出时会做旧值归一 */
export type LossScope = ConcreteLossScope | '未知'

export function normalizeLossScope(raw: unknown): LossScope {
  const s = String(raw ?? '').trim()
  if (s === '库内丢包') return '库内丢失'
  if (s === '库外丢包') return '库外丢失'
  if (s === '3PL丢失') return '3PL丢件'
  if (s === '退返商家') return '未知'
  if ((LOSS_SCOPE_OPTIONS as readonly string[]).includes(s)) return s as ConcreteLossScope
  if (s === '未知') return '未知'
  return '未知'
}

/** 与将来 PostgreSQL `exception_categories` 行对齐 */
export type ExceptionCategoryEntity = {
  id: string
  name: string
  /** 分类说明，参与分析时的 few-shot 提示 */
  description: string
  lossScope: LossScope
  createdAt: string
  updatedAt: string
}

/** 与将来 PostgreSQL `exception_samples` 行对齐 */
export type ExceptionSampleEntity = {
  id: string
  categoryId: string
  orderNo: string
  tracks: TrackEvent[]
  fetchedAt: string
}
