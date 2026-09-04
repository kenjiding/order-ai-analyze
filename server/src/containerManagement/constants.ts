/** 容器管理：品类、站点类型、流转类型/状态、台账原因类型的常量与中文标签 */

export const CONTAINER_TYPES = ['BIG_BASKET', 'SILVER_BOX'] as const
export type ContainerType = (typeof CONTAINER_TYPES)[number]

export const containerTypeLabel: Record<ContainerType, string> = {
  BIG_BASKET: '大蓝筐',
  SILVER_BOX: '银筐',
}

export const ACCOUNT_KINDS = ['BROKER', 'CUSTOMER', 'CSP', 'INTERNAL_WAREHOUSE'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

export const accountKindLabel: Record<AccountKind, string> = {
  BROKER: '清关行',
  CUSTOMER: '客户',
  CSP: 'CSP',
  INTERNAL_WAREHOUSE: '内部仓库',
}

export const TRANSFER_KINDS = [
  'LEND',
  'RETURN',
  'INTERNAL_TRANSFER',
  'IN_TRANSIT_OUT',
  'IN_TRANSIT_IN',
] as const
export type TransferKind = (typeof TRANSFER_KINDS)[number]

export const transferKindLabel: Record<TransferKind, string> = {
  LEND: '借出',
  RETURN: '归还',
  INTERNAL_TRANSFER: '仓间调拨',
  IN_TRANSIT_OUT: '在途发出',
  IN_TRANSIT_IN: '在途签收',
}

export const TRANSFER_STATUSES = [
  'PENDING_RECEIVER',
  'DISPUTED',
  'CONFIRMED',
  'CANCELLED',
  'VOIDED',
] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const transferStatusLabel: Record<TransferStatus, string> = {
  PENDING_RECEIVER: '待接收方确认',
  DISPUTED: '协商中',
  CONFIRMED: '已确认',
  CANCELLED: '已取消',
  VOIDED: '已作废',
}

/** 借出与归还需接收方确认后双方库存才变动；其余类型创建时即记账 */
export function transferKindNeedsReceiverConfirmation(kind: TransferKind): boolean {
  return kind === 'LEND' || kind === 'RETURN'
}

/** 未确认的借出/归还会占用转出方的可用量 */
export const PENDING_OUTBOUND_STATUSES: TransferStatus[] = ['PENDING_RECEIVER', 'DISPUTED']

export const BALANCE_REASON_TYPES = [
  'INITIAL_STOCKTAKE',
  'STOCKTAKE_CORRECTION',
  'DAMAGE_SCRAP',
  'LOSS_REPORT',
  'HISTORICAL_BACKFILL',
  'TRANSFER_SETTLEMENT',
  'TRANSFER_VOID',
] as const
export type BalanceReasonType = (typeof BALANCE_REASON_TYPES)[number]

/** 手工调账可选的原因类型；两个 TRANSFER_* 只由流转记账与作废冲账写入，不开放给用户选 */
const AUTO_BALANCE_REASON_TYPES: readonly BalanceReasonType[] = ['TRANSFER_SETTLEMENT', 'TRANSFER_VOID']

export const MANUAL_BALANCE_REASON_TYPES = BALANCE_REASON_TYPES.filter(
  (item) => !AUTO_BALANCE_REASON_TYPES.includes(item),
) as readonly BalanceReasonType[]

export const BALANCE_AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'TRANSFER'] as const
export type BalanceAuditAction = (typeof BALANCE_AUDIT_ACTIONS)[number]

export const TRANSFER_CHANGE_ACTIONS = ['UPDATE', 'DELETE', 'VOID'] as const
export type TransferChangeAction = (typeof TRANSFER_CHANGE_ACTIONS)[number]

export function isContainerType(value: unknown): value is ContainerType {
  return CONTAINER_TYPES.includes(value as ContainerType)
}

export function isAccountKind(value: unknown): value is AccountKind {
  return ACCOUNT_KINDS.includes(value as AccountKind)
}

export function isTransferKind(value: unknown): value is TransferKind {
  return TRANSFER_KINDS.includes(value as TransferKind)
}

export function isTransferStatus(value: unknown): value is TransferStatus {
  return TRANSFER_STATUSES.includes(value as TransferStatus)
}

export function isManualBalanceReasonType(value: unknown): value is BalanceReasonType {
  return MANUAL_BALANCE_REASON_TYPES.includes(value as BalanceReasonType)
}

/** 流转记录对外编号：主键是自增数字，展示统一补零加前缀 */
export const TRANSFER_NO_PREFIX = 'TR-'

export function formatTransferNo(id: number): string {
  return `${TRANSFER_NO_PREFIX}${String(id).padStart(6, '0')}`
}

/** 解析用户输入的编号：允许 123 / TR-000123 / tr000123 三种写法 */
export function parseTransferNo(raw: unknown): number | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const digits = text.replace(/^tr[-\s]?/i, '').replace(/^0+(?=\d)/, '')
  if (!/^\d+$/.test(digits)) return null
  const value = Number(digits)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
