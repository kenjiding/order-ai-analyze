/** 容器管理：全部后端请求 */
import { backendFetch } from '../api/httpClient'
import type { AccountPushNotify } from './pushNotify'
import type {
  AssignableUser,
  BalanceAudit,
  BoundUser,
  ContainerAccount,
  ContainerBalance,
  ContainerType,
  Paged,
  ReconciliationSummary,
  Transfer,
  TransferChange,
  TransferDetail,
  TransferKind,
  TransferStatus,
} from './types'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

const BASE = '/api/container-management'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await backendFetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    type Wire = { ok?: boolean; data?: T; error?: string }
    const json = (await res.json()) as Wire
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

function toQuery(params: Record<string, string | number | undefined | null>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}

// ------------------------------------------------------------ 站点账户

/** scope='manage' 用于站点账户维护页：有维护权限时返回全部站点，与改名/删除的作用域一致 */
export function fetchAccounts(
  counterparty = false,
  scope?: 'manage',
): Promise<ApiResult<ContainerAccount[]>> {
  return apiFetch<ContainerAccount[]>(
    `/accounts${toQuery({ counterparty: counterparty ? '1' : '', scope })}`,
  )
}

export function fetchAssignableUsers(): Promise<ApiResult<AssignableUser[]>> {
  return apiFetch<AssignableUser[]>('/accounts/assignable-users')
}

export function createAccount(body: {
  name: string
  kind: string
  isExternal: boolean
  userIds: string[]
  pushNotify: AccountPushNotify
}): Promise<ApiResult<ContainerAccount>> {
  return apiFetch<ContainerAccount>('/accounts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateAccount(
  id: string,
  body: {
    name?: string
    kind?: string
    isExternal?: boolean
    userIds?: string[]
    pushNotify?: AccountPushNotify
  },
): Promise<ApiResult<ContainerAccount>> {
  return apiFetch<ContainerAccount>(`/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteAccount(id: string): Promise<ApiResult<null>> {
  return apiFetch<null>(`/accounts/${id}`, { method: 'DELETE' })
}

export function fetchAccountUsers(id: string): Promise<ApiResult<BoundUser[]>> {
  return apiFetch<BoundUser[]>(`/accounts/${id}/users`)
}

export function saveAccountUsers(id: string, userIds: string[]): Promise<ApiResult<BoundUser[]>> {
  return apiFetch<BoundUser[]>(`/accounts/${id}/users`, {
    method: 'PUT',
    body: JSON.stringify({ userIds }),
  })
}

// ------------------------------------------------------------ 容器台账

export function fetchBalances(): Promise<ApiResult<ContainerBalance[]>> {
  return apiFetch<ContainerBalance[]>('/balances')
}

/** 站点对账：以 accountId 为「我」，返回与各对手方的净往来 */
export function fetchReconciliation(accountId: string): Promise<ApiResult<ReconciliationSummary>> {
  return apiFetch<ReconciliationSummary>(`/reconciliation${toQuery({ accountId })}`)
}

export function createBalance(body: {
  accountId: string
  containerType: ContainerType
  quantity: number
}): Promise<ApiResult<ContainerBalance>> {
  return apiFetch<ContainerBalance>('/balances', { method: 'POST', body: JSON.stringify(body) })
}

export function updateBalance(
  id: string,
  body: { quantity: number; reasonType: string; reason: string },
): Promise<ApiResult<ContainerBalance>> {
  return apiFetch<ContainerBalance>(`/balances/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteBalance(
  id: string,
  body: { reasonType: string; reason: string },
): Promise<ApiResult<null>> {
  return apiFetch<null>(`/balances/${id}`, { method: 'DELETE', body: JSON.stringify(body) })
}

export function fetchBalanceAudits(params: {
  accountId?: string
  containerType?: string
  reasonType?: string
  action?: string
  start?: string
  end?: string
  page: number
  pageSize: number
}): Promise<ApiResult<Paged<BalanceAudit>>> {
  return apiFetch<Paged<BalanceAudit>>(`/balance-audits${toQuery(params)}`)
}

// ------------------------------------------------------------ 流转记录

export function fetchTransfers(params: {
  transferId?: number
  fromAccountId?: string
  toAccountId?: string
  status?: TransferStatus | ''
  start?: string
  end?: string
  page: number
  pageSize: number
}): Promise<ApiResult<Paged<Transfer>>> {
  return apiFetch<Paged<Transfer>>(`/transfers${toQuery(params)}`)
}

export function fetchTransferDetail(id: number): Promise<ApiResult<TransferDetail>> {
  return apiFetch<TransferDetail>(`/transfers/${id}`)
}

export type TransferCreateItem = {
  kind: TransferKind
  fromAccountId: string
  toAccountId: string
  lineItems: { containerType: ContainerType; quantity: number }[]
  /** 业务发生日期 YYYY-MM-DD */
  occurredAt: string
  note?: string | null
}

/** 整批一个事务：任何一组不合法都整批失败，错误信息带组序号 */
export function createTransfers(items: TransferCreateItem[]): Promise<ApiResult<Transfer[]>> {
  return apiFetch<Transfer[]>('/transfers', { method: 'POST', body: JSON.stringify({ items }) })
}

/** Excel 批量导入：语义同上，上限 200 行，错误信息带行号；后端不推飞书 */
export function importTransfers(items: TransferCreateItem[]): Promise<ApiResult<{ created: number }>> {
  return apiFetch<{ created: number }>('/transfers/import', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export function updateTransfer(
  id: number,
  body: {
    lineItems?: { containerType: ContainerType; quantity: number }[]
    occurredAt?: string
    note?: string | null
    reason?: string
  },
): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteTransfer(id: number, reason: string): Promise<ApiResult<null>> {
  return apiFetch<null>(`/transfers/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  })
}

export function confirmTransfer(id: number, note: string): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}/confirm`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  })
}

/** 接收方无系统账号时，转出方凭线下回单单方面确认并入账 */
export function proxyConfirmTransfer(
  id: number,
  body: { note: string; evidenceUrl: string | null },
): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}/proxy-confirm`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function reportReceipt(
  id: number,
  body: {
    lineItems: { containerType: ContainerType; quantity: number }[]
    reason: string
    receiverReportImageUrl?: string | null
  },
  isUpdate = false,
): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}/${isUpdate ? 'receiver-report' : 'report-receipt'}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function acceptSettlement(id: number): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}/accept-settlement`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })
}

export function fetchTransferChanges(params: {
  transferId?: number
  action?: string
  start?: string
  end?: string
  page: number
  pageSize: number
}): Promise<ApiResult<Paged<TransferChange>>> {
  return apiFetch<Paged<TransferChange>>(`/transfer-changes${toQuery(params)}`)
}

// ------------------------------------------------------------ 图片

export function uploadContainerImage(dataUrl: string): Promise<ApiResult<{ url: string }>> {
  return apiFetch<{ url: string }>('/images', {
    method: 'POST',
    body: JSON.stringify({ dataUrl }),
  })
}
