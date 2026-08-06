import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from '../../../utils/toast'

export type ScheduleApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ScheduleListCrudApi<TSchedule extends { id: string }, TDraft> {
  load: () => Promise<ScheduleApiResult<TSchedule[]>>
  create: (draft: TDraft, imileToken: string) => Promise<ScheduleApiResult<TSchedule>>
  update: (id: string, draft: TDraft, imileToken: string) => Promise<ScheduleApiResult<TSchedule>>
  remove: (id: string) => Promise<ScheduleApiResult<null>>
}

export interface ScheduleListCrudMessages {
  missingImileToken: string
  loadError: string
  createSuccess: string
  updateSuccess: string
  saveError: string
  deleteSuccess: string
  deleteError: string
  toggleError: string
}

/**
 * 出仓告警 / 派签告警 / 催派推送 / 工单推送共用的"列表 + 抽屉表单 + 启用开关"增删改逻辑。
 *
 * 排查 11 点前出仓告警"点一项启用、全部变启用"的 bug 时发现：旧实现每次 toggle 后都会
 * 触发一次全量 GET 覆盖 state，多次快速操作时旧的、更晚返回的 GET 响应会把新状态覆盖回去。
 * 这里改为用 PUT 返回的最新单行数据直接局部替换（toggleEnabled），reload 也加了序号保护，
 * 只接受最新一次触发的响应，从根源上消除该竞态。
 */
export function useScheduleListCrud<TSchedule extends { id: string }, TDraft>(
  api: ScheduleListCrudApi<TSchedule, TDraft>,
  messages: ScheduleListCrudMessages,
) {
  const [schedules, setSchedules] = useState<TSchedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<TSchedule | null>(null)

  const initRef = useRef(false)
  const reloadSeqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++reloadSeqRef.current
    setSchedulesLoading(true)
    const res = await api.load()
    if (seq !== reloadSeqRef.current) return
    setSchedulesLoading(false)
    if (res.ok) {
      setSchedules(res.data)
    } else {
      showToast(`${messages.loadError}: ${res.error}`, 'error')
    }
  }, [api, messages.loadError])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    void reload()
  }, [reload])

  const openCreateDrawer = useCallback(() => {
    setEditingSchedule(null)
    setDrawerOpen(true)
  }, [])

  const openEditDrawer = useCallback((schedule: TSchedule) => {
    setEditingSchedule(schedule)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setEditingSchedule(null)
  }, [])

  const submitDrawer = useCallback(
    async (draft: TDraft, imileToken: string): Promise<boolean> => {
      if (!imileToken.trim()) {
        showToast(messages.missingImileToken, 'error')
        return false
      }
      setSaving(true)
      try {
        const res = editingSchedule
          ? await api.update(editingSchedule.id, draft, imileToken)
          : await api.create(draft, imileToken)
        if (res.ok) {
          showToast(editingSchedule ? messages.updateSuccess : messages.createSuccess, 'success')
          await reload()
          return true
        }
        showToast(`${messages.saveError}: ${res.error}`, 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [editingSchedule, api, messages, reload],
  )

  const removeSchedule = useCallback(
    async (id: string) => {
      const res = await api.remove(id)
      if (res.ok) {
        showToast(messages.deleteSuccess, 'success')
        await reload()
      } else {
        showToast(`${messages.deleteError}: ${res.error}`, 'error')
      }
    },
    [api, messages, reload],
  )

  const toggleEnabled = useCallback(
    async (schedule: TSchedule, draft: TDraft, imileToken: string) => {
      setTogglingIds((prev) => new Set(prev).add(schedule.id))
      try {
        const res = await api.update(schedule.id, draft, imileToken)
        if (res.ok) {
          setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? res.data : s)))
        } else {
          showToast(`${messages.toggleError}: ${res.error}`, 'error')
        }
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev)
          next.delete(schedule.id)
          return next
        })
      }
    },
    [api, messages.toggleError],
  )

  return {
    schedules,
    schedulesLoading,
    saving,
    togglingIds,
    drawerOpen,
    editingSchedule,
    openCreateDrawer,
    openEditDrawer,
    closeDrawer,
    submitDrawer,
    removeSchedule,
    toggleEnabled,
    reload,
  }
}
