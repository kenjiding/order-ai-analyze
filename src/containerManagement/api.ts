/** 容器管理：全部后端请求 */
import { backendFetch } from '../api/httpClient'
import type {
  AssignableUser,
  BalanceAudit,
  BoundUser,
  ContainerAccount,
  ContainerBalance,
  ContainerType,
  Paged,
  Transfer,
  TransferChange,
  TransferDetail,
  TransferKind,
  TransferMessage,
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

// ------------------------------------------------------------ 主体账户

export function fetchAccounts(counterparty = false): Promise<ApiResult<ContainerAccount[]>> {
  return apiFetch<ContainerAccount[]>(`/accounts${counterparty ? '?counterparty=1' : ''}`)
}

export function fetchAssignableUsers(): Promise<ApiResult<AssignableUser[]>> {
  return apiFetch<AssignableUser[]>('/accounts/assignable-users')
}

export function createAccount(body: {
  name: string
  kind: string
}): Promise<ApiResult<ContainerAccount>> {
  return apiFetch<ContainerAccount>('/accounts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateAccount(
  id: string,
  body: { name?: string; kind?: string },
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
  transferId?: string
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

export function fetchTransferDetail(id: string): Promise<ApiResult<TransferDetail>> {
  return apiFetch<TransferDetail>(`/transfers/${id}`)
}

export function createTransfer(body: {
  kind: TransferKind
  fromAccountId: string
  toAccountId: string
  lineItems: { containerType: ContainerType; quantity: number }[]
  imageUrl?: string | null
  note?: string | null
}): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>('/transfers', { method: 'POST', body: JSON.stringify(body) })
}

export function updateTransfer(
  id: string,
  body: {
    lineItems?: { containerType: ContainerType; quantity: number }[]
    imageUrl?: string | null
    note?: string | null
    reason?: string
  },
): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteTransfer(id: string, reason: string): Promise<ApiResult<null>> {
  return apiFetch<null>(`/transfers/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  })
}

export function confirmTransfer(id: string, note: string): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}/confirm`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  })
}

export function reportReceipt(
  id: string,
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

export function addTransferMessage(
  id: string,
  body: { body: string; proposedQuantity?: number | null },
): Promise<ApiResult<TransferMessage[]>> {
  return apiFetch<TransferMessage[]>(`/transfers/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function acceptSettlement(id: string): Promise<ApiResult<Transfer>> {
  return apiFetch<Transfer>(`/transfers/${id}/accept-settlement`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })
}

export function fetchTransferChanges(params: {
  transferId?: string
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
