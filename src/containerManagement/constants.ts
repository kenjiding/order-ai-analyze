/** 容器管理：中文标签、状态配色与选项列表 */
import type {
  AccountKind,
  BalanceAuditAction,
  BalanceReasonType,
  ContainerType,
  TransferChangeAction,
  TransferKind,
  TransferStatus,
} from './types'

export const CONTAINER_TYPES: ContainerType[] = ['BIG_BASKET', 'SILVER_BOX']

export const containerTypeLabel: Record<ContainerType, string> = {
  BIG_BASKET: '大篮筐',
  SILVER_BOX: '银框',
}

export const ACCOUNT_KINDS: AccountKind[] = ['BROKER', 'CUSTOMER', 'INTERNAL_WAREHOUSE']

export const accountKindLabel: Record<AccountKind, string> = {
  BROKER: '清关行',
  CUSTOMER: '客户',
  INTERNAL_WAREHOUSE: '内部仓库',
}

/** 新增流转记录时可选的业务类型；其余类型仅用于展示历史数据 */
export const SELECTABLE_TRANSFER_KINDS: TransferKind[] = ['LEND', 'RETURN']

export const transferKindLabel: Record<TransferKind, string> = {
  LEND: '借出',
  RETURN: '归还',
  INTERNAL_TRANSFER: '仓间调拨',
  IN_TRANSIT_OUT: '在途发出',
  IN_TRANSIT_IN: '在途签收',
}

export const TRANSFER_STATUSES: TransferStatus[] = [
  'PENDING_RECEIVER',
  'DISPUTED',
  'CONFIRMED',
  'CANCELLED',
]

export const transferStatusLabel: Record<TransferStatus, string> = {
  PENDING_RECEIVER: '待接收方确认',
  DISPUTED: '协商中',
  CONFIRMED: '已确认',
  CANCELLED: '已取消',
}

/** antd Tag 的 color，语义与原系统一致：待确认橙、协商中紫、已确认绿、已取消灰 */
export const transferStatusColor: Record<TransferStatus, string> = {
  PENDING_RECEIVER: 'orange',
  DISPUTED: 'purple',
  CONFIRMED: 'green',
  CANCELLED: 'default',
}

/** 手工调账可选的原因类型；TRANSFER_SETTLEMENT 由流转记账自动写入 */
export const MANUAL_BALANCE_REASON_TYPES: BalanceReasonType[] = [
  'INITIAL_STOCKTAKE',
  'STOCKTAKE_CORRECTION',
  'DAMAGE_SCRAP',
  'LOSS_REPORT',
  'HISTORICAL_BACKFILL',
]

export const balanceReasonTypeLabel: Record<BalanceReasonType, string> = {
  INITIAL_STOCKTAKE: '初始盘点',
  STOCKTAKE_CORRECTION: '盘点纠偏',
  DAMAGE_SCRAP: '破损报废',
  LOSS_REPORT: '丢失申报',
  HISTORICAL_BACKFILL: '历史补录',
  TRANSFER_SETTLEMENT: '流转记账',
}

export const balanceReasonTypeHint: Record<BalanceReasonType, string> = {
  INITIAL_STOCKTAKE: '首次建账时录入当前实盘基线。',
  STOCKTAKE_CORRECTION: '盘点发现账实差异后的修正。',
  DAMAGE_SCRAP: '容器破损且已报废，不再计入可用库存。',
  LOSS_REPORT: '容器丢失或无法追回时的损失登记。',
  HISTORICAL_BACKFILL: '补录历史期间遗漏的台账变更。',
  TRANSFER_SETTLEMENT: '由流转记录确认落表自动产生，不可手工选择。',
}

export const balanceAuditActionLabel: Record<BalanceAuditAction, string> = {
  CREATE: '新增',
  UPDATE: '修改',
  DELETE: '删除',
  TRANSFER: '流转',
}

export const transferChangeActionLabel: Record<TransferChangeAction, string> = {
  UPDATE: '编辑',
  DELETE: '删除',
}

export function containerTypeName(code: string): string {
  return containerTypeLabel[code as ContainerType] ?? code
}

/** 借出与归还需接收方确认；与后端 transferKindNeedsReceiverConfirmation 一致 */
export function transferKindNeedsReceiverConfirmation(kind: TransferKind): boolean {
  return kind === 'LEND' || kind === 'RETURN'
}

/** 流转记录对外编号：主键是自增数字，展示统一补零加前缀（与后端 constants 保持一致） */
export const TRANSFER_NO_PREFIX = 'TR-'

export function formatTransferNo(id: number): string {
  return `${TRANSFER_NO_PREFIX}${String(id).padStart(6, '0')}`
}

/** 解析用户输入的编号：允许 123 / TR-000123 / tr000123 三种写法 */
export function parseTransferNo(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  const digits = text.replace(/^tr[-\s]?/i, '').replace(/^0+(?=\d)/, '')
  if (!/^\d+$/.test(digits)) return null
  const value = Number(digits)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
