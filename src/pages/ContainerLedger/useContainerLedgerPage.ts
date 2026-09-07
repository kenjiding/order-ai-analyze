import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import {
  createBalance,
  deleteBalance,
  fetchAccounts,
  fetchBalanceAudits,
  fetchBalances,
  updateBalance,
} from '../../containerManagement/api'
import type {
  BalanceAudit,
  BalanceReasonType,
  ContainerAccount,
  ContainerBalance,
  ContainerType,
} from '../../containerManagement/types'
import { usePermission } from '../../hooks/usePermission'
import { showToast } from '../../utils/toast'

export type BalanceCreateDraft = {
  accountId: string
  containerType: ContainerType
  quantity: number
}

export type BalanceReasonDraft = {
  reasonType: BalanceReasonType
  reason: string
}

export type AuditFilters = {
  accountId: string
  containerType: string
  reasonType: string
  action: string
  range: [Dayjs, Dayjs] | null
}

const AUDIT_PAGE_SIZE = 10

const emptyAuditFilters: AuditFilters = {
  accountId: '',
  containerType: '',
  reasonType: '',
  action: '',
  range: null,
}

export function useContainerLedgerPage() {
  const { t } = useTranslation('container')
  const canDelete = usePermission('btn:container-ledger:delete')

  const [tab, setTab] = useState<'balances' | 'audits' | 'reconciliation' | 'types'>('balances')
  const [accounts, setAccounts] = useState<ContainerAccount[]>([])
  const [balances, setBalances] = useState<ContainerBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<ContainerBalance | null>(null)
  const [deleting, setDeleting] = useState<ContainerBalance | null>(null)

  const [audits, setAudits] = useState<BalanceAudit[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(emptyAuditFilters)

  const loadBalances = useCallback(async () => {
    setLoading(true)
    const res = await fetchBalances()
    setLoading(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setBalances(res.data)
  }, [])

  const loadAccounts = useCallback(async () => {
    const res = await fetchAccounts()
    if (!res.ok) return
    setAccounts(res.data)
  }, [])

  const loadAudits = useCallback(
    async (page = auditPage, filters = auditFilters) => {
      setAuditLoading(true)
      const res = await fetchBalanceAudits({
        accountId: filters.accountId || undefined,
        containerType: filters.containerType || undefined,
        reasonType: filters.reasonType || undefined,
        action: filters.action || undefined,
        start: filters.range?.[0].startOf('day').toISOString(),
        end: filters.range?.[1].endOf('day').toISOString(),
        page,
        pageSize: AUDIT_PAGE_SIZE,
      })
      setAuditLoading(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      setAudits(res.data.items)
      setAuditTotal(res.data.total)
    },
    [auditPage, auditFilters],
  )

  useEffect(() => {
    void loadBalances()
    void loadAccounts()
  }, [loadBalances, loadAccounts])

  useEffect(() => {
    if (tab === 'audits') void loadAudits(auditPage, auditFilters)
    // 仅在切到审计 Tab 或翻页时拉取；筛选条件变更由「搜索」按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, auditPage])

  const applyAuditFilters = useCallback(
    (next: AuditFilters) => {
      setAuditFilters(next)
      setAuditPage(1)
      void loadAudits(1, next)
    },
    [loadAudits],
  )

  const refreshAfterChange = useCallback(async () => {
    await loadBalances()
    if (tab === 'audits') await loadAudits(1, auditFilters)
  }, [loadBalances, loadAudits, tab, auditFilters])

  const submitCreate = useCallback(
    async (draft: BalanceCreateDraft): Promise<boolean> => {
      setSubmitting(true)
      const res = await createBalance(draft)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(t('toast.balanceCreated'), 'success')
      setCreateOpen(false)
      await refreshAfterChange()
      return true
    },
    [refreshAfterChange, t],
  )

  const submitEdit = useCallback(
    async (quantity: number, reason: BalanceReasonDraft): Promise<boolean> => {
      if (!editing) return false
      setSubmitting(true)
      const res = await updateBalance(editing.id, { quantity, ...reason })
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(t('toast.balanceUpdated'), 'success')
      setEditing(null)
      await refreshAfterChange()
      return true
    },
    [editing, refreshAfterChange, t],
  )

  const submitDelete = useCallback(
    async (reason: BalanceReasonDraft): Promise<boolean> => {
      if (!deleting) return false
      setSubmitting(true)
      const res = await deleteBalance(deleting.id, reason)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      showToast(t('toast.balanceDeleted'), 'success')
      setDeleting(null)
      await refreshAfterChange()
      return true
    },
    [deleting, refreshAfterChange, t],
  )

  return useMemo(
    () => ({
      canDelete,
      tab,
      setTab,
      accounts,
      balances,
      loading,
      submitting,
      createOpen,
      openCreate: () => setCreateOpen(true),
      closeCreate: () => setCreateOpen(false),
      submitCreate,
      editing,
      openEdit: setEditing,
      closeEdit: () => setEditing(null),
      submitEdit,
      deleting,
      openDelete: setDeleting,
      closeDelete: () => setDeleting(null),
      submitDelete,
      audits,
      auditTotal,
      auditPage,
      setAuditPage,
      auditLoading,
      auditFilters,
      applyAuditFilters,
      auditPageSize: AUDIT_PAGE_SIZE,
    }),
    [
      canDelete,
      tab,
      accounts,
      balances,
      loading,
      submitting,
      createOpen,
      submitCreate,
      editing,
      submitEdit,
      deleting,
      submitDelete,
      audits,
      auditTotal,
      auditPage,
      auditLoading,
      auditFilters,
      applyAuditFilters,
    ],
  )
}
