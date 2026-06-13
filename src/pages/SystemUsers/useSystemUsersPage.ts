import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminPermissions,
  fetchAdminRegions,
  fetchAdminUsers,
  updateAdminUser,
  updateAdminUserPermissions,
  type AdminUser,
  type PermissionDefinition,
} from '../../api/adminUsersApi'
import type { RegionOption } from '../../api/authApi'
import { type UserFormValues } from './components/UserFormModal'

export function useSystemUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [userRows, regionRows, permissionRows] = await Promise.all([
        fetchAdminUsers(),
        fetchAdminRegions(),
        fetchAdminPermissions(),
      ])
      setUsers(userRows)
      setRegions(regionRows)
      setPermissions(permissionRows)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = useCallback(() => {
    setEditingUser(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((user: AdminUser) => {
    setEditingUser(user)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingUser(null)
  }, [])

  const handleSubmit = useCallback(
    async (values: UserFormValues) => {
      setSaving(true)
      setError(null)
      try {
        if (editingUser) {
          await updateAdminUser(editingUser.id, {
            displayName: values.displayName,
            isActive: values.isActive,
            password: values.password || undefined,
          })
          if (editingUser.role !== 'super_admin') {
            await updateAdminUserPermissions(editingUser.id, values.permissionKeys)
          }
        } else {
          await createAdminUser({
            regionCode: values.regionCode,
            username: values.username,
            password: values.password,
            displayName: values.displayName,
            permissionKeys: values.permissionKeys,
          })
        }
        closeModal()
        await reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [closeModal, editingUser, reload],
  )

  const handleDisable = useCallback(
    async (user: AdminUser) => {
      if (!window.confirm(`确定禁用用户 ${user.username}（${user.regionName ?? '系统'}）？`)) return
      setError(null)
      try {
        await deleteAdminUser(user.id)
        await reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败')
      }
    },
    [reload],
  )

  const menuPermissions = useMemo(
    () => permissions.filter((item) => item.type === 'menu'),
    [permissions],
  )
  const buttonPermissions = useMemo(
    () => permissions.filter((item) => item.type === 'button'),
    [permissions],
  )

  return {
    users,
    regions,
    permissions,
    menuPermissions,
    buttonPermissions,
    loading,
    error,
    modalOpen,
    editingUser,
    saving,
    openCreate,
    openEdit,
    closeModal,
    handleSubmit,
    handleDisable,
    reload,
  }
}
