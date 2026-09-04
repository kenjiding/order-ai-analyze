import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { useSearchParams } from 'react-router-dom'
import {
  acceptSettlement,
  confirmTransfer,
  proxyConfirmTransfer,
  createTransfers,
  deleteTransfer,
  fetchAccounts,
  fetchTransferChanges,
  fetchTransferDetail,
  fetchTransfers,
  importTransfers,
  reportReceipt,
  updateTransfer,
} from '../../containerManagement/api'
import type { TransferCreateItem } from '../../containerManagement/api'
import { TRANSFER_STATUSES, parseTransferNo } from '../../containerManagement/constants'
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
import { mapImportErrorRowNo } from './transferImportParse'
import { downloadTransferImportTemplate } from './transferImportTemplate'
import { usePermission } from '../../hooks/usePermission'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../utils/toast'

const PAGE_SIZE = 10
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

/** 表单里的一组流转；新增可以有多组，编辑只有一组 */
export type TransferDraft = {
  kind: TransferKind
  fromAccountId: string
  toAccountId: string
  lines: TransferLineDraft[]
  /** 业务发生日期 YYYY-MM-DD */
  occurredAt: string
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

/**
 * 可以从 URL 带入的筛选项：台账跳转带 transferId，
 * 批量流转汇总卡片的按钮带 toAccountId + status（它指不到具体某一笔）。
 */
const URL_SEED_FILTER_KEYS = ['transferId', 'fromAccountId', 'toAccountId', 'status'] as const

export function toLineItems(lines: TransferLineDraft[]) {
  return lines.map((line) => ({
    containerType: line.containerType as ContainerType,
    quantity: Number(line.quantity || 0),
  }))
}

export function useContainerTransfersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin)
  const canProxyConfirm = usePermission('btn:container-transfers:proxy-confirm')

  const [tab, setTab] = useState<'transfers' | 'changes'>('transfers')
  const [ownAccounts, setOwnAccounts] = useState<ContainerAccount[]>([])
  const [counterparties, setCounterparties] = useState<ContainerAccount[]>([])

  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filters, setFilters] = useState<TransferFilters>(() => {
    const status = searchParams.get('status') ?? ''
    return {
      ...emptyFilters,
      transferId: searchParams.get('transferId') ?? '',
      fromAccountId: searchParams.get('fromAccountId') ?? '',
      toAccountId: searchParams.get('toAccountId') ?? '',
      status: TRANSFER_STATUSES.includes(status as TransferStatus) ? (status as TransferStatus) : '',
    }
  })

  const [changes, setChanges] = useState<TransferChange[]>([])
  const [changeTotal, setChangeTotal] = useState(0)
  const [changePage, setChangePage] = useState(1)
  const [changeLoading, setChangeLoading] = useState(false)
  const [changeFilters, setChangeFilters] = useState<ChangeFilters>(emptyChangeFilters)

  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [templateDownloading, setTemplateDownloading] = useState(false)
  const [editing, setEditing] = useState<Transfer | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Transfer | null>(null)
  /** 代确认与普通确认共用弹窗组件，但走不同接口，所以分开存目标 */
  const [proxyConfirmTarget, setProxyConfirmTarget] = useState<Transfer | null>(null)
  const [disputeTarget, setDisputeTarget] = useState<Transfer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Transfer | null>(null)
  const [detail, setDetail] = useState<TransferDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  /** 与原系统一致：「查看记录」只看时间线，「协商」才有操作表单，两个抽屉分开 */
  const [drawer, setDrawer] = useState<'timeline' | 'negotiate' | null>(null)

  /** 所有可选站点（转出方 + 接收方去重），用于筛选与展示 */
  const allAccounts = useMemo(() => {
    const map = new Map<string, ContainerAccount>()
    for (const account of [...ownAccounts, ...counterparties]) map.set(account.id, account)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [ownAccounts, counterparties])

  const ownAccountIds = useMemo(() => new Set(ownAccounts.map((a) => a.id)), [ownAccounts])

  /**
   * 可作为转出方的账户：自己绑定的站点，加上外部方。
   * 外部方（清关行、客户）登不进系统，他们归还容器的单子只能由内部人员以他们的身份代录，
   * 所以他们虽然落在 counterparties 里，也要出现在转出方下拉。
   */
  const senderAccounts = useMemo(
    () => [...ownAccounts, ...counterparties.filter((account) => account.isExternal)],
    [ownAccounts, counterparties],
  )

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
    async (nextPage = page, nextFilters = filters, nextPageSize = pageSize) => {
      setLoading(true)
      const res = await fetchTransfers({
        transferId: parseTransferNo(nextFilters.transferId) ?? undefined,
        fromAccountId: nextFilters.fromAccountId || undefined,
        toAccountId: nextFilters.toAccountId || undefined,
        status: nextFilters.status || undefined,
        start: nextFilters.range?.[0].startOf('day').toISOString(),
        end: nextFilters.range?.[1].endOf('day').toISOString(),
        page: nextPage,
        pageSize: nextPageSize,
      })
      setLoading(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      setTransfers(res.data.items)
      setTotal(res.data.total)
    },
    [page, filters, pageSize],
  )

  const loadChanges = useCallback(
    async (nextPage = changePage, nextFilters = changeFilters) => {
      setChangeLoading(true)
      const res = await fetchTransferChanges({
        transferId: parseTransferNo(nextFilters.transferId) ?? undefined,
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
    void loadTransfers(page, filters, pageSize)
    // 翻页 / 改每页条数与首次进入拉取；筛选条件变更由「搜索」按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize])

  useEffect(() => {
    if (tab === 'changes') void loadChanges(changePage, changeFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, changePage])

  const applyFilters = useCallback(
    (next: TransferFilters) => {
      setFilters(next)
      setPage(1)
      // URL 上的筛选只用于从台账/飞书卡片跳转带入，应用筛选后即清掉
      if (URL_SEED_FILTER_KEYS.some((key) => searchParams.has(key))) {
        setSearchParams({}, { replace: true })
      }
      void loadTransfers(1, next, pageSize)
    },
    [loadTransfers, pageSize, searchParams, setSearchParams],
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

  const openDrawer = useCallback(
    async (transfer: Transfer, mode: 'timeline' | 'negotiate') => {
      setDrawer(mode)
      setDetail(null)
      setDetailLoading(true)
      const res = await fetchTransferDetail(transfer.id)
      setDetailLoading(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        setDrawer(null)
        return
      }
      setDetail(res.data)
    },
    [],
  )

  const reloadDetail = useCallback(async (transferId: number) => {
    const res = await fetchTransferDetail(transferId)
    if (res.ok) setDetail(res.data)
  }, [])

  /**
   * 飞书卡片按钮带 ?transferId=&action= 进来时，列表就位后自动打开对应弹窗。
   * 卡片是发出时的状态，用户点开时可能已经变了，对不上就退回时间线并说明原因。
   */
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current) return
    const action = searchParams.get('action')
    const targetId = parseTransferNo(searchParams.get('transferId') ?? '')
    if (!action || targetId === null || transfers.length === 0) return
    deepLinkHandled.current = true

    const next = new URLSearchParams(searchParams)
    next.delete('action')
    setSearchParams(next, { replace: true })

    const target = transfers.find((item) => item.id === targetId)
    if (!target) {
      showToast('没找到这笔流转，可能已被删除或你无权查看', 'error')
      return
    }
    if (action === 'confirm') {
      if (target.status !== 'PENDING_RECEIVER') {
        showToast('这笔流转已经不在待确认状态，为你打开记录', 'info')
        void openDrawer(target, 'timeline')
        return
      }
      if (!canActAs(target.toAccountId)) {
        showToast('只有接收方可以确认收货，为你打开记录', 'info')
        void openDrawer(target, 'timeline')
        return
      }
      setConfirmTarget(target)
      return
    }
    if (action === 'negotiate') {
      if (target.status !== 'DISPUTED') {
        showToast('这笔流转已经不在协商中，为你打开记录', 'info')
        void openDrawer(target, 'timeline')
        return
      }
      void openDrawer(target, 'negotiate')
      return
    }
    void openDrawer(target, 'timeline')
  }, [transfers, searchParams, setSearchParams, openDrawer, canActAs])

  /** 新增走整批提交，编辑只改当前这一条 */
  const submitTransfer = useCallback(
    async (drafts: TransferDraft[]): Promise<boolean> => {
      if (drafts.length === 0) return false
      setSubmitting(true)
      const res = editing
        ? await updateTransfer(editing.id, {
            lineItems:
              editing.status === 'PENDING_RECEIVER' ? toLineItems(drafts[0].lines) : undefined,
            occurredAt: drafts[0].occurredAt,
            reason: '',
          })
        : await createTransfers(
            drafts.map((draft) => ({
              kind: draft.kind,
              fromAccountId: draft.fromAccountId,
              toAccountId: draft.toAccountId,
              lineItems: toLineItems(draft.lines),
              occurredAt: draft.occurredAt,
              note: draft.note.trim() || null,
            })),
          )
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(
        editing ? '已更新流转记录' : `已创建 ${drafts.length} 条流转记录`,
        'success',
      )
      setFormOpen(false)
      setEditing(null)
      await refresh()
      return true
    },
    [editing, refresh],
  )

  /** 模板里的转出方/接收方下拉取值就是这两份账户列表，所以在 hook 里出模板 */
  const downloadImportTemplate = useCallback(async () => {
    setTemplateDownloading(true)
    try {
      await downloadTransferImportTemplate(senderAccounts, counterparties)
    } catch (error) {
      console.error('[container-transfer-import] 模板生成失败', error)
      showToast('模板生成失败，请重试', 'error')
    } finally {
      setTemplateDownloading(false)
    }
  }, [senderAccounts, counterparties])

  /** Excel 批量导入：整批一个事务，行已在前端逐条校验过，这里只处理后端返回 */
  const submitImport = useCallback(
    async (items: TransferCreateItem[], rowNos: number[]): Promise<boolean> => {
      if (items.length === 0) return false
      setSubmitting(true)
      const res = await importTransfers(items)
      setSubmitting(false)
      if (!res.ok) {
        showToast(mapImportErrorRowNo(res.error, rowNos), 'error')
        return false
      }
      showToast(`已导入 ${res.data.created} 条流转记录`, 'success')
      setImportOpen(false)
      await refresh()
      return true
    },
    [refresh],
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

  const submitProxyConfirm = useCallback(
    async (note: string, evidenceUrl: string | null): Promise<boolean> => {
      if (!proxyConfirmTarget) return false
      setSubmitting(true)
      const res = await proxyConfirmTransfer(proxyConfirmTarget.id, { note, evidenceUrl })
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast('已按回单确认，库存已记账', 'success')
      setProxyConfirmTarget(null)
      await refresh()
      return true
    },
    [proxyConfirmTarget, refresh],
  )

  const submitDispute = useCallback(
    async (
      lines: TransferLineDraft[],
      reason: string,
      imageUrl: string | null,
      isUpdate: boolean,
      transferId?: number,
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

  /** 二次确认由协商抽屉内联展示（与原系统一致），这里只负责提交 */
  const submitAcceptSettlement = useCallback(
    async (transfer: Transfer): Promise<boolean> => {
      const received = transfer.receivedTotal ?? 0
      setSubmitting(true)
      const res = await acceptSettlement(transfer.id)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(received === 0 ? '已取消该流转' : '已认可结算数量并完成记账', 'success')
      await refresh()
      if (detail?.id === transfer.id) await reloadDetail(transfer.id)
      return true
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
      senderAccounts,
      counterparties,
      canActAs,
      transfers,
      total,
      page,
      pageSize,
      setPage,
      setPageSize,
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
      importOpen,
      templateDownloading,
      downloadImportTemplate: () => void downloadImportTemplate(),
      openImport: () => setImportOpen(true),
      closeImport: () => setImportOpen(false),
      submitImport,
      confirmTarget,
      openConfirm: setConfirmTarget,
      closeConfirm: () => setConfirmTarget(null),
      submitConfirm,
      canProxyConfirm,
      proxyConfirmTarget,
      openProxyConfirm: setProxyConfirmTarget,
      closeProxyConfirm: () => setProxyConfirmTarget(null),
      submitProxyConfirm,
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
      drawer,
      openTimeline: (transfer: Transfer) => void openDrawer(transfer, 'timeline'),
      openNegotiate: (transfer: Transfer) => void openDrawer(transfer, 'negotiate'),
      closeDrawer: () => {
        setDrawer(null)
        setDetail(null)
      },
      submitAcceptSettlement,
    }),
    [
      tab,
      isSuperAdmin,
      allAccounts,
      ownAccounts,
      senderAccounts,
      counterparties,
      canActAs,
      transfers,
      total,
      page,
      pageSize,
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
      importOpen,
      templateDownloading,
      downloadImportTemplate,
      submitImport,
      confirmTarget,
      submitConfirm,
      canProxyConfirm,
      proxyConfirmTarget,
      submitProxyConfirm,
      disputeTarget,
      submitDispute,
      deleteTarget,
      submitDelete,
      detail,
      detailLoading,
      drawer,
      openDrawer,
      submitAcceptSettlement,
    ],
  )
}
