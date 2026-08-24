import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { useSearchParams } from 'react-router-dom'
import {
  acceptSettlement,
  addTransferMessage,
  confirmTransfer,
  createTransfer,
  deleteTransfer,
  fetchAccounts,
  fetchTransferChanges,
  fetchTransferDetail,
  fetchTransfers,
  reportReceipt,
  updateTransfer,
} from '../../containerManagement/api'
import type {
  ContainerAccount,
  ContainerType,
  Transfer,
  TransferChange,
  TransferDetail,
  TransferKind,
  TransferLineDraft,
  TransferStatus,
} from '../../containerManagement/types'
import { useAuthStore } from '../../stores/authStore'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'

const PAGE_SIZE = 12
const CHANGE_PAGE_SIZE = 10

export type TransferFilters = {
  transferId: string
  fromAccountId: string
  toAccountId: string
  status: TransferStatus | ''
  range: [Dayjs, Dayjs] | null
}

export type ChangeFilters = {
  transferId: string
  action: string
  range: [Dayjs, Dayjs] | null
}

export type TransferDraft = {
  kind: TransferKind
  fromAccountId: string
  toAccountId: string
  lines: TransferLineDraft[]
  imageUrl: string | null
  note: string
}

const emptyFilters: TransferFilters = {
  transferId: '',
  fromAccountId: '',
  toAccountId: '',
  status: '',
  range: null,
}

const emptyChangeFilters: ChangeFilters = { transferId: '', action: '', range: null }

export function toLineItems(lines: TransferLineDraft[]) {
  return lines.map((line) => ({
    containerType: line.containerType as ContainerType,
    quantity: Number(line.quantity || 0),
  }))
}

export function useContainerTransfersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin)

  const [tab, setTab] = useState<'transfers' | 'changes'>('transfers')
  const [ownAccounts, setOwnAccounts] = useState<ContainerAccount[]>([])
  const [counterparties, setCounterparties] = useState<ContainerAccount[]>([])

  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filters, setFilters] = useState<TransferFilters>(() => {
    const fromUrl = searchParams.get('transferId')
    return fromUrl ? { ...emptyFilters, transferId: fromUrl } : emptyFilters
  })

  const [changes, setChanges] = useState<TransferChange[]>([])
  const [changeTotal, setChangeTotal] = useState(0)
  const [changePage, setChangePage] = useState(1)
  const [changeLoading, setChangeLoading] = useState(false)
  const [changeFilters, setChangeFilters] = useState<ChangeFilters>(emptyChangeFilters)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Transfer | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Transfer | null>(null)
  const [disputeTarget, setDisputeTarget] = useState<Transfer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transfer | null>(null)
  const [detail, setDetail] = useState<TransferDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  /** 所有可选主体（转出方 + 接收方去重），用于筛选与展示 */
  const allAccounts = useMemo(() => {
    const map = new Map<string, ContainerAccount>()
    for (const account of [...ownAccounts, ...counterparties]) map.set(account.id, account)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [ownAccounts, counterparties])

  const ownAccountIds = useMemo(() => new Set(ownAccounts.map((a) => a.id)), [ownAccounts])

  const canActAs = useCallback(
    (accountId: string) => isSuperAdmin || ownAccountIds.has(accountId),
    [isSuperAdmin, ownAccountIds],
  )

  const loadAccounts = useCallback(async () => {
    const [own, others] = await Promise.all([fetchAccounts(false), fetchAccounts(true)])
    if (own.ok) setOwnAccounts(own.data)
    if (others.ok) setCounterparties(others.data)
  }, [])

  const loadTransfers = useCallback(
    async (nextPage = page, nextFilters = filters) => {
      setLoading(true)
      const res = await fetchTransfers({
        transferId: nextFilters.transferId.trim() || undefined,
        fromAccountId: nextFilters.fromAccountId || undefined,
        toAccountId: nextFilters.toAccountId || undefined,
        status: nextFilters.status || undefined,
        start: nextFilters.range?.[0].startOf('day').toISOString(),
        end: nextFilters.range?.[1].endOf('day').toISOString(),
        page: nextPage,
        pageSize: PAGE_SIZE,
      })
      setLoading(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      setTransfers(res.data.items)
      setTotal(res.data.total)
    },
    [page, filters],
  )

  const loadChanges = useCallback(
    async (nextPage = changePage, nextFilters = changeFilters) => {
      setChangeLoading(true)
      const res = await fetchTransferChanges({
        transferId: nextFilters.transferId.trim() || undefined,
        action: nextFilters.action || undefined,
        start: nextFilters.range?.[0].startOf('day').toISOString(),
        end: nextFilters.range?.[1].endOf('day').toISOString(),
        page: nextPage,
        pageSize: CHANGE_PAGE_SIZE,
      })
      setChangeLoading(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      setChanges(res.data.items)
      setChangeTotal(res.data.total)
    },
    [changePage, changeFilters],
  )

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    void loadTransfers(page, filters)
    // 翻页与首次进入拉取；筛选条件变更由「搜索」按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    if (tab === 'changes') void loadChanges(changePage, changeFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, changePage])

  const applyFilters = useCallback(
    (next: TransferFilters) => {
      setFilters(next)
      setPage(1)
      // URL 上的 transferId 只用于从台账跳转带入，应用筛选后即清掉
      if (searchParams.has('transferId')) setSearchParams({}, { replace: true })
      void loadTransfers(1, next)
    },
    [loadTransfers, searchParams, setSearchParams],
  )

  const applyChangeFilters = useCallback(
    (next: ChangeFilters) => {
      setChangeFilters(next)
      setChangePage(1)
      void loadChanges(1, next)
    },
    [loadChanges],
  )

  const refresh = useCallback(async () => {
    await loadTransfers(page, filters)
    if (tab === 'changes') await loadChanges(changePage, changeFilters)
  }, [loadTransfers, loadChanges, page, filters, tab, changePage, changeFilters])

  const openDetail = useCallback(async (transfer: Transfer) => {
    setDetailLoading(true)
    const res = await fetchTransferDetail(transfer.id)
    setDetailLoading(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setDetail(res.data)
  }, [])

  const reloadDetail = useCallback(async (transferId: string) => {
    const res = await fetchTransferDetail(transferId)
    if (res.ok) setDetail(res.data)
  }, [])

  const submitTransfer = useCallback(
    async (draft: TransferDraft): Promise<boolean> => {
      setSubmitting(true)
      const lineItems = toLineItems(draft.lines)
      const res = editing
        ? await updateTransfer(editing.id, {
            lineItems: editing.status === 'PENDING_RECEIVER' ? lineItems : undefined,
            imageUrl: draft.imageUrl,
            reason: '',
          })
        : await createTransfer({
            kind: draft.kind,
            fromAccountId: draft.fromAccountId,
            toAccountId: draft.toAccountId,
            lineItems,
            imageUrl: draft.imageUrl,
            note: draft.note.trim() || null,
          })
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(editing ? '已更新流转记录' : '已创建流转记录', 'success')
      setFormOpen(false)
      setEditing(null)
      await refresh()
      return true
    },
    [editing, refresh],
  )

  const submitConfirm = useCallback(
    async (note: string): Promise<boolean> => {
      if (!confirmTarget) return false
      setSubmitting(true)
      const res = await confirmTransfer(confirmTarget.id, note)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast('已确认收货，库存已记账', 'success')
      setConfirmTarget(null)
      await refresh()
      return true
    },
    [confirmTarget, refresh],
  )

  const submitDispute = useCallback(
    async (
      lines: TransferLineDraft[],
      reason: string,
      imageUrl: string | null,
      isUpdate: boolean,
      transferId?: string,
    ): Promise<boolean> => {
      const id = transferId ?? disputeTarget?.id
      if (!id) return false
      setSubmitting(true)
      const res = await reportReceipt(
        id,
        { lineItems: toLineItems(lines), reason, receiverReportImageUrl: imageUrl },
        isUpdate,
      )
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(isUpdate ? '已更新实收申报' : '已提交差异申报', 'success')
      setDisputeTarget(null)
      await refresh()
      if (detail?.id === id) await reloadDetail(id)
      return true
    },
    [disputeTarget, refresh, detail, reloadDetail],
  )

  const sendMessage = useCallback(
    async (transferId: string, body: string): Promise<boolean> => {
      const res = await addTransferMessage(transferId, { body })
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      await reloadDetail(transferId)
      return true
    },
    [reloadDetail],
  )

  const submitAcceptSettlement = useCallback(
    async (transfer: Transfer): Promise<void> => {
      const received = transfer.receivedTotal ?? 0
      const confirmed = await confirmDialog({
        title: '确认按接收方申报的数量结算？',
        content:
          received === 0
            ? '接收方申报实收 0，认可后本条流转将被取消，双方库存不变。'
            : `认可后立即按各品类实收数量记账，合计 ${received} 个（申报 ${transfer.declaredTotal} 个）。该操作不可撤销。`,
        danger: received === 0,
      })
      if (!confirmed) return
      setSubmitting(true)
      const res = await acceptSettlement(transfer.id)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      showToast(received === 0 ? '已取消该流转' : '已认可结算数量并完成记账', 'success')
      await refresh()
      if (detail?.id === transfer.id) await reloadDetail(transfer.id)
    },
    [refresh, detail, reloadDetail],
  )

  const submitDelete = useCallback(
    async (reason: string): Promise<boolean> => {
      if (!deleteTarget) return false
      setSubmitting(true)
      const res = await deleteTransfer(deleteTarget.id, reason)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast('已删除流转记录', 'success')
      setDeleteTarget(null)
      await refresh()
      return true
    },
    [deleteTarget, refresh],
  )

  return useMemo(
    () => ({
      tab,
      setTab,
      isSuperAdmin,
      allAccounts,
      ownAccounts,
      counterparties,
      canActAs,
      transfers,
      total,
      page,
      pageSize: PAGE_SIZE,
      setPage,
      loading,
      submitting,
      filters,
      applyFilters,
      changes,
      changeTotal,
      changePage,
      changePageSize: CHANGE_PAGE_SIZE,
      setChangePage,
      changeLoading,
      changeFilters,
      applyChangeFilters,
      formOpen,
      editing,
      openCreate: () => {
        setEditing(null)
        setFormOpen(true)
      },
      openEdit: (transfer: Transfer) => {
        setEditing(transfer)
        setFormOpen(true)
      },
      closeForm: () => {
        setFormOpen(false)
        setEditing(null)
      },
      submitTransfer,
      confirmTarget,
      openConfirm: setConfirmTarget,
      closeConfirm: () => setConfirmTarget(null),
      submitConfirm,
      disputeTarget,
      openDispute: setDisputeTarget,
      closeDispute: () => setDisputeTarget(null),
      submitDispute,
      deleteTarget,
      openDelete: setDeleteTarget,
      closeDelete: () => setDeleteTarget(null),
      submitDelete,
      detail,
      detailLoading,
      openDetail,
      closeDetail: () => setDetail(null),
      sendMessage,
      submitAcceptSettlement,
    }),
    [
      tab,
      isSuperAdmin,
      allAccounts,
      ownAccounts,
      counterparties,
      canActAs,
      transfers,
      total,
      page,
      loading,
      submitting,
      filters,
      applyFilters,
      changes,
      changeTotal,
      changePage,
      changeLoading,
      changeFilters,
      applyChangeFilters,
      formOpen,
      editing,
      submitTransfer,
      confirmTarget,
      submitConfirm,
      disputeTarget,
      submitDispute,
      deleteTarget,
      submitDelete,
      detail,
      detailLoading,
      openDetail,
      sendMessage,
      submitAcceptSettlement,
    ],
  )
}
