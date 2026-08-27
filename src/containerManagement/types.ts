/** 容器管理：与后端接口对齐的类型定义 */
import type { AccountPushNotify } from './pushNotify'

export type ContainerType = 'BIG_BASKET' | 'SILVER_BOX'
export type AccountKind = 'BROKER' | 'CUSTOMER' | 'INTERNAL_WAREHOUSE'
export type TransferKind =
  | 'LEND'
  | 'RETURN'
  | 'INTERNAL_TRANSFER'
  | 'IN_TRANSIT_OUT'
  | 'IN_TRANSIT_IN'
export type TransferStatus = 'PENDING_RECEIVER' | 'DISPUTED' | 'CONFIRMED' | 'CANCELLED'
export type BalanceReasonType =
  | 'INITIAL_STOCKTAKE'
  | 'STOCKTAKE_CORRECTION'
  | 'DAMAGE_SCRAP'
  | 'LOSS_REPORT'
  | 'HISTORICAL_BACKFILL'
  | 'TRANSFER_SETTLEMENT'
export type BalanceAuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'TRANSFER'
export type TransferChangeAction = 'UPDATE' | 'DELETE'

export type ContainerAccount = {
  id: string
  name: string
  kind: AccountKind
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
  toAccountId: string
  toAccountName: string
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
  createdByUsername: string | null
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
