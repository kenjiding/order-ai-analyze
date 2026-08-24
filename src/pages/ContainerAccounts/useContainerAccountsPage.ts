import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  fetchAssignableUsers,
  saveAccountUsers,
  updateAccount,
} from '../../containerManagement/api'
import type { AccountKind, AssignableUser, ContainerAccount } from '../../containerManagement/types'
import { usePermission } from '../../hooks/usePermission'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'

export type AccountDraft = { name: string; kind: AccountKind }

export function useContainerAccountsPage() {
  const canManage = usePermission('btn:container-accounts:manage')

  const [accounts, setAccounts] = useState<ContainerAccount[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ContainerAccount | null>(null)
  const [bindingAccount, setBindingAccount] = useState<ContainerAccount | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    const res = await fetchAccounts()
    setLoading(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setAccounts(res.data)
  }, [])

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
      showToast(editing ? '已更新主体账户' : '已新增主体账户', 'success')
      closeForm()
      return true
    },
    [editing, closeForm],
  )

  const removeAccount = useCallback(async (account: ContainerAccount) => {
    const confirmed = await confirmDialog({
      title: `确认删除主体「${account.name}」？`,
      content: '若该主体已有容器台账或流转记录，删除会被拒绝。',
      danger: true,
    })
    if (!confirmed) return
    const res = await deleteAccount(account.id)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setAccounts((prev) => prev.filter((item) => item.id !== account.id))
    showToast('已删除主体账户', 'success')
  }, [])

  const submitBinding = useCallback(
    async (userIds: string[]): Promise<boolean> => {
      if (!bindingAccount) return false
      setSubmitting(true)
      const res = await saveAccountUsers(bindingAccount.id, userIds)
      setSubmitting(false)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === bindingAccount.id ? { ...item, boundUserIds: userIds } : item,
        ),
      )
      showToast('已保存绑定关系', 'success')
      setBindingAccount(null)
      return true
    },
    [bindingAccount],
  )

  return useMemo(
    () => ({
      canManage,
      accounts,
      users,
      loading,
      submitting,
      formOpen,
      editing,
      bindingAccount,
      openCreate,
      openEdit,
      closeForm,
      submitAccount,
      removeAccount,
      openBinding: setBindingAccount,
      closeBinding: () => setBindingAccount(null),
      submitBinding,
    }),
    [
      canManage,
      accounts,
      users,
      loading,
      submitting,
      formOpen,
      editing,
      bindingAccount,
      openCreate,
      openEdit,
      closeForm,
      submitAccount,
      removeAccount,
      submitBinding,
    ],
  )
}
