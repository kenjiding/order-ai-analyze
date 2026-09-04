/** 容器管理：与后端接口对齐的类型定义 */
import type { AccountPushNotify } from './pushNotify'

export type ContainerType = 'BIG_BASKET' | 'SILVER_BOX'
export type AccountKind = 'BROKER' | 'CUSTOMER' | 'CSP' | 'INTERNAL_WAREHOUSE'
export type TransferKind =
  | 'LEND'
  | 'RETURN'
  | 'INTERNAL_TRANSFER'
  | 'IN_TRANSIT_OUT'
  | 'IN_TRANSIT_IN'
export type TransferStatus =
  | 'PENDING_RECEIVER'
  | 'DISPUTED'
  | 'CONFIRMED'
  /** 协商认可实收为 0，从未入账 */
  | 'CANCELLED'
  /** 入账后人工撤销，余额已由反向流水冲平 */
  | 'VOIDED'
export type BalanceReasonType =
  | 'INITIAL_STOCKTAKE'
  | 'STOCKTAKE_CORRECTION'
  | 'DAMAGE_SCRAP'
  | 'LOSS_REPORT'
  | 'HISTORICAL_BACKFILL'
  | 'TRANSFER_SETTLEMENT'
  | 'TRANSFER_VOID'
export type BalanceAuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'TRANSFER'
export type TransferChangeAction = 'UPDATE' | 'DELETE' | 'VOID'

export type ContainerAccount = {
  id: string
  name: string
  kind: AccountKind
  /** 该账户方在本系统没有登录账号，需要我方代确认收货 / 代录归还单 */
  isExternal: boolean
  boundUserIds: string[]
  pushNotify: AccountPushNotify
  createdAt: string
}

export type AssignableUser = {
  id: string
  username: string
  displayName: string | null
}

export type BoundUser = AssignableUser & { isActive: boolean }

export type ContainerBalance = {
  id: string
  accountId: string
  accountName: string
  accountKind: AccountKind
  containerType: ContainerType
  quantity: number
  updatedAt: string
}

export type BalanceAudit = {
  id: string
  action: BalanceAuditAction
  accountId: string
  accountName: string
  containerType: ContainerType
  prevQuantity: number | null
  newQuantity: number | null
  delta: number | null
  reasonType: BalanceReasonType
  reason: string
  transferId: number | null
  actorUsername: string | null
  createdAt: string
}

/** 对账：与某个对手方在某品类上的往来。net > 0 对方欠我，net < 0 我欠对方 */
export type ReconciliationRow = {
  counterpartyId: string
  counterpartyName: string
  counterpartyKind: AccountKind
  containerType: ContainerType
  outQty: number
  inQty: number
  pendingOut: number
  pendingIn: number
  net: number
}

export type ReconciliationSummary = {
  rows: ReconciliationRow[]
  /** 按品类合计对方欠我的量 */
  owedToMe: Record<ContainerType, number>
  /** 按品类合计我欠对方的量（正数） */
  owedByMe: Record<ContainerType, number>
}

export type TransferItem = {
  containerType: ContainerType
  declaredQuantity: number
  receivedQuantity: number | null
  settledQuantity: number | null
}

export type Transfer = {
  id: number
  kind: TransferKind
  status: TransferStatus
  fromAccountId: string
  fromAccountName: string
  fromAccountIsExternal: boolean
  toAccountId: string
  toAccountName: string
  toAccountIsExternal: boolean
  items: TransferItem[]
  declaredTotal: number
  receivedTotal: number | null
  settledTotal: number | null
  /** 业务发生日期 YYYY-MM-DD */
  occurredAt: string
  note: string | null
  receiverReportReason: string | null
  receiverReportImageUrl: string | null
  responseNote: string | null
  senderAcceptedAt: string | null
  respondedAt: string | null
  /** 本单是我方凭线下回单代对方确认的，不是对方本人确认 */
  proxyConfirmed: boolean
  proxyEvidenceUrl: string | null
  createdByUsername: string | null
  respondedByUsername: string | null
  /** 作废信息取自变更审计里的那条 VOID；三个都为 null 即未作废 */
  voidedAt: string | null
  voidedReason: string | null
  voidedByUsername: string | null
  createdAt: string
}

export type TransferDetail = Transfer

export type TransferSnapshot = {
  id: number
  kind: TransferKind
  status: TransferStatus
  fromAccountId: string
  toAccountId: string
  occurredAt: string
  note: string | null
  items: TransferItem[]
}

export type TransferChange = {
  id: string
  transferId: number | null
  action: TransferChangeAction
  reason: string
  beforeData: TransferSnapshot
  afterData: TransferSnapshot | null
  actorUsername: string | null
  createdAt: string
}

export type Paged<T> = { items: T[]; total: number }

/** 表单里的流转明细行，数量用字符串以便输入过程中允许为空 */
export type TransferLineDraft = { containerType: ContainerType; quantity: string }
