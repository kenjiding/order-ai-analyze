import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('systemUsers')
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
      showToast(e instanceof Error ? e.message : t('loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

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
        showToast(editingUser ? t('userUpdated') : t('userCreated'), 'success')
      } catch (e) {
        showToast(e instanceof Error ? e.message : t('saveFailed'), 'error')
      } finally {
        setSaving(false)
      }
    },
    [closeModal, editingUser, reload, t],
  )

  const handleDisable = useCallback(
    async (user: AdminUser) => {
      const confirmed = await confirmDialog({
        title: t('disableUserTitle'),
        content: t('disableUserContent', {
          username: user.username,
          region: user.regionName ?? t('systemAdmin'),
        }),
        okText: t('disable'),
        danger: true,
      })
      if (!confirmed) return
      try {
        await deleteAdminUser(user.id)
        await reload()
        showToast(t('userDisabled'), 'success')
      } catch (e) {
        showToast(e instanceof Error ? e.message : t('operationFailed'), 'error')
      }
    },
    [reload, t],
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
