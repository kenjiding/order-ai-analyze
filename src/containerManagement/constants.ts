/** 容器管理：状态配色、选项列表与编号工具（标签走 i18n container 命名空间） */
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

export const ACCOUNT_KINDS: AccountKind[] = ['BROKER', 'CUSTOMER', 'CSP', 'INTERNAL_WAREHOUSE']

/**
 * 新建站点时「该站点方没有本系统账号」的默认值。
 * 清关行与客户绝大多数没有账号，默认勾上省一次手；仍可手动改，改过之后换类型不再覆盖。
 */
export function defaultIsExternal(kind: AccountKind): boolean {
  return kind === 'BROKER' || kind === 'CUSTOMER'
}

/** 新增流转记录时可选的业务类型；其余类型仅用于展示历史数据 */
export const SELECTABLE_TRANSFER_KINDS: TransferKind[] = ['LEND', 'RETURN']

export const TRANSFER_STATUSES: TransferStatus[] = [
  'PENDING_RECEIVER',
  'DISPUTED',
  'CONFIRMED',
  'CANCELLED',
  'VOIDED',
]

export const BALANCE_AUDIT_ACTIONS: BalanceAuditAction[] = ['CREATE', 'UPDATE', 'DELETE', 'TRANSFER']

export const TRANSFER_CHANGE_ACTIONS: TransferChangeAction[] = ['UPDATE', 'DELETE', 'VOID']

/** 手工调账可选的原因类型；TRANSFER_SETTLEMENT 由流转记账自动写入 */
export const MANUAL_BALANCE_REASON_TYPES: BalanceReasonType[] = [
  'INITIAL_STOCKTAKE',
  'STOCKTAKE_CORRECTION',
  'DAMAGE_SCRAP',
  'LOSS_REPORT',
  'HISTORICAL_BACKFILL',
]

/** 筛选场景需包含流转自动写入的原因类型 */
export const FILTER_BALANCE_REASON_TYPES: BalanceReasonType[] = [
  'TRANSFER_SETTLEMENT',
  'TRANSFER_VOID',
  'TRANSIT_LOSS',
  ...MANUAL_BALANCE_REASON_TYPES,
]

/** antd Tag 的 color：待确认橙、协商中紫、已确认绿、已取消灰、已作废红（这条账被冲回了） */
export const transferStatusColor: Record<TransferStatus, string> = {
  PENDING_RECEIVER: 'orange',
  DISPUTED: 'purple',
  CONFIRMED: 'green',
  CANCELLED: 'default',
  VOIDED: 'red',
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
