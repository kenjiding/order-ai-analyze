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
import { showToast } from '../../utils/toast'
import { confirmDialog } from '../../utils/confirmDialog'
import { type UserFormValues } from './components/UserFormModal'

export function useSystemUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
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
      showToast(e instanceof Error ? e.message : '加载失败', 'error')
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
      try {
        const permissionKeys = Array.isArray(values.permissionKeys) ? values.permissionKeys : []

        if (editingUser) {
          await updateAdminUser(editingUser.id, {
            username: values.username,
            displayName: values.displayName,
            isActive: values.isActive,
            password: values.password || undefined,
          })
          if (editingUser.role !== 'super_admin') {
            await updateAdminUserPermissions(editingUser.id, permissionKeys)
          }
        } else {
          await createAdminUser({
            regionCode: values.regionCode,
            username: values.username,
            password: values.password,
            displayName: values.displayName,
            permissionKeys,
          })
        }
        closeModal()
        await reload()
        showToast(editingUser ? '用户已更新' : '用户已创建', 'success')
      } catch (e) {
        showToast(e instanceof Error ? e.message : '保存失败', 'error')
      } finally {
        setSaving(false)
      }
    },
    [closeModal, editingUser, reload],
  )

  const handleDisable = useCallback(
    async (user: AdminUser) => {
      const confirmed = await confirmDialog({
        title: '禁用用户',
        content: `确定禁用用户 ${user.username}（${user.regionName ?? '系统'}）？`,
        okText: '禁用',
        danger: true,
      })
      if (!confirmed) return
      try {
        await deleteAdminUser(user.id)
        await reload()
        showToast('用户已禁用', 'success')
      } catch (e) {
        showToast(e instanceof Error ? e.message : '操作失败', 'error')
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
