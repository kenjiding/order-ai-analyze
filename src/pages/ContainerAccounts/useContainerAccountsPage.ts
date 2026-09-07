import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  fetchAssignableUsers,
  updateAccount,
} from '../../containerManagement/api'
import type { AccountPushNotify } from '../../containerManagement/pushNotify'
import type { AccountKind, AssignableUser, ContainerAccount } from '../../containerManagement/types'
import { usePermission } from '../../hooks/usePermission'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'

/** 一次表单提交携带站点信息、绑定用户与推送配置，后端在同一个事务里落库 */
export type AccountDraft = {
  name: string
  kind: AccountKind
  isExternal: boolean
  userIds: string[]
  pushNotify: AccountPushNotify
}

export function useContainerAccountsPage() {
  const { t } = useTranslation('container')
  const canManage = usePermission('btn:container-accounts:manage')

  const [accounts, setAccounts] = useState<ContainerAccount[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [keyword, setKeyword] = useState('')
  const [kindFilter, setKindFilter] = useState<AccountKind | ''>('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ContainerAccount | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    const res = await fetchAccounts(false, canManage ? 'manage' : undefined)
    setLoading(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setAccounts(res.data)
  }, [canManage])

  const loadUsers = useCallback(async () => {
    if (!canManage) return
    const res = await fetchAssignableUsers()
    if (!res.ok) return
    setUsers(res.data)
  }, [canManage])

  useEffect(() => {
    void loadAccounts()
    void loadUsers()
  }, [loadAccounts, loadUsers])

  /** 站点账户一次性全量拉取，筛选直接在前端做，不再往返后端 */
  const filteredAccounts = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return accounts.filter(
      (item) =>
        (!kw || item.name.toLowerCase().includes(kw)) &&
        (!kindFilter || item.kind === kindFilter),
    )
  }, [accounts, keyword, kindFilter])

  const openCreate = useCallback(() => {
    setEditing(null)
    setFormOpen(true)
  }, [])

  const openEdit = useCallback((account: ContainerAccount) => {
    setEditing(account)
    setFormOpen(true)
  }, [])

  const closeForm = useCallback(() => {
    setFormOpen(false)
    setEditing(null)
  }, [])

  const submitAccount = useCallback(
    async (draft: AccountDraft): Promise<boolean> => {
      setSubmitting(true)
      const res = editing
        ? await updateAccount(editing.id, draft)
        : await createAccount(draft)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      setAccounts((prev) =>
        editing
          ? prev.map((item) => (item.id === res.data.id ? res.data : item))
          : [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      )
      showToast(editing ? t('toast.accountUpdated') : t('toast.accountCreated'), 'success')
      closeForm()
      return true
    },
    [editing, closeForm, t],
  )

  const removeAccount = useCallback(async (account: ContainerAccount) => {
    const confirmed = await confirmDialog({
      title: t('accounts.confirmDeleteTitle', { name: account.name }),
      content: t('accounts.confirmDeleteContent'),
      danger: true,
    })
    if (!confirmed) return
    const res = await deleteAccount(account.id)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setAccounts((prev) => prev.filter((item) => item.id !== account.id))
    showToast(t('toast.accountDeleted'), 'success')
  }, [t])

  return useMemo(
    () => ({
      canManage,
      accounts,
      filteredAccounts,
      keyword,
      setKeyword,
      kindFilter,
      setKindFilter,
      users,
      loading,
      submitting,
      formOpen,
      editing,
      openCreate,
      openEdit,
      closeForm,
      submitAccount,
      removeAccount,
    }),
    [
      canManage,
      accounts,
      filteredAccounts,
      keyword,
      kindFilter,
      users,
      loading,
      submitting,
      formOpen,
      editing,
      openCreate,
      openEdit,
      closeForm,
      submitAccount,
      removeAccount,
    ],
  )
}
