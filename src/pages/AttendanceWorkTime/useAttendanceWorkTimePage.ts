import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../utils/toast'
import { confirmDialog } from '../../utils/confirmDialog'
import {
  createAttendanceWorkRecord,
  deleteAttendanceWorkRecord,
  fetchAttendanceWorkRecords,
  searchAttendanceWorkers,
  updateAttendanceWorkRecord,
} from './attendanceWorkTimeApi'
import {
  AU_REGIONS,
  type AttendanceWorkRecord,
  type AttendanceWorkRecordDraft,
  type AttendanceWorkerSuggestion,
} from './attendanceWorkTimeTypes'

export type AttendanceFilters = {
  regionCode: string | null
  dateRange: [Dayjs, Dayjs] | null
}

export function useAttendanceWorkTimePage(isMobile: boolean) {
  const { t } = useTranslation('attendanceWorkTime')
  const { user, isSuperAdmin } = useAuthStore()
  // 超管账号的 regionCode 是 'system' 哨兵值，不对应真实州/区域；仅当命中真实州/区域列表时才作为“本人所属州”使用，
  // 否则移动端「现场记录」筛选/创建会把 'system' 当作真实州传给后端，被 isAssignableRegionCode 拒绝为“无效的州/区域”
  const rawRegionCode = user?.regionCode ?? null
  const ownRegionCode = rawRegionCode && AU_REGIONS.some((r) => r.code === rawRegionCode) ? rawRegionCode : null

  const [records, setRecords] = useState<AttendanceWorkRecord[]>([])
  const [loading, setLoading] = useState(false)
  // regionCode 仅记录超管手选的筛选值；非超管始终按 ownRegionCode 过滤，见 effectiveRegionCode
  const [filters, setFilters] = useState<AttendanceFilters>({
    regionCode: null,
    dateRange: [dayjs().startOf('day'), dayjs().endOf('day')],
  })
  // 移动端是现场记录页面，没有筛选入口，始终只看/只建自己账号所属州/区域的数据
  const effectiveRegionCode = isMobile ? ownRegionCode : isSuperAdmin ? filters.regionCode : ownRegionCode

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<AttendanceWorkRecord | null>(null)

  const [workerSuggestions, setWorkerSuggestions] = useState<AttendanceWorkerSuggestion[]>([])
  const [workerSearchLoading, setWorkerSearchLoading] = useState(false)
  const workerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchAttendanceWorkRecords({
        regionCode: effectiveRegionCode,
        startDate: filters.dateRange ? filters.dateRange[0].toISOString() : null,
        endDate: filters.dateRange ? filters.dateRange[1].toISOString() : null,
      })
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      setRecords(res.data)
    } finally {
      setLoading(false)
    }
  }, [effectiveRegionCode, filters.dateRange])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  const openCreate = useCallback(() => {
    setEditingRecord(null)
    setWorkerSuggestions([])
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((record: AttendanceWorkRecord) => {
    setEditingRecord(record)
    setWorkerSuggestions([])
    setDialogOpen(true)
  }, [])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingRecord(null)
  }, [])

  const submitRecord = useCallback(
    async (draft: AttendanceWorkRecordDraft): Promise<boolean> => {
      const res = editingRecord
        ? await updateAttendanceWorkRecord(editingRecord.id, draft)
        : await createAttendanceWorkRecord(draft)
      if (!res.ok) {
        showToast(res.error, 'error')
        return false
      }
      setRecords((prev) =>
        editingRecord ? prev.map((r) => (r.id === res.data.id ? res.data : r)) : [res.data, ...prev],
      )
      showToast(editingRecord ? t('toast.updated') : t('toast.added'), 'success')
      closeDialog()
      return true
    },
    [editingRecord, closeDialog, t],
  )

  const removeRecord = useCallback(async (record: AttendanceWorkRecord) => {
    const confirmed = await confirmDialog({
      title: t('confirm.deleteTitle'),
      content: t('confirm.deleteContent', { workerName: record.workerName }),
      danger: true,
    })
    if (!confirmed) return
    const res = await deleteAttendanceWorkRecord(record.id)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setRecords((prev) => prev.filter((r) => r.id !== record.id))
    showToast(t('toast.deleted'), 'success')
  }, [t])

  /** 快速记录结束时间：把当前时间写入该记录的结束时间，用于现场"下班/收工"一键打卡 */
  const quickFinishRecord = useCallback(async (record: AttendanceWorkRecord) => {
    const now = new Date()
    if (now.getTime() <= new Date(record.startTime).getTime()) {
      showToast(t('toast.endTimeAfterStart'), 'error')
      return
    }
    const draft: AttendanceWorkRecordDraft = {
      regionCode: record.regionCode,
      workerName: record.workerName,
      processCategory: record.processCategory,
      shift: record.shift,
      zoneCode: record.zoneCode,
      startTime: record.startTime,
      endTime: now.toISOString(),
      notes: record.notes,
    }
    const res = await updateAttendanceWorkRecord(record.id, draft)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    setRecords((prev) => prev.map((r) => (r.id === res.data.id ? res.data : r)))
    showToast(t('toast.finished'), 'success')
  }, [t])

  const searchWorkers = useCallback(
    (query: string, regionCodeForSearch: string | null) => {
      if (workerSearchTimer.current) clearTimeout(workerSearchTimer.current)
      const trimmed = query.trim()
      if (!trimmed) {
        setWorkerSuggestions([])
        return
      }
      workerSearchTimer.current = setTimeout(async () => {
        setWorkerSearchLoading(true)
        try {
          const res = await searchAttendanceWorkers(trimmed, regionCodeForSearch)
          setWorkerSuggestions(res.ok ? res.data : [])
        } finally {
          setWorkerSearchLoading(false)
        }
      }, 300)
    },
    [],
  )

  const setRegionFilter = useCallback(
    (regionCode: string | null) => {
      if (!isSuperAdmin) return
      setFilters((prev) => ({ ...prev, regionCode }))
    },
    [isSuperAdmin],
  )

  const setDateRangeFilter = useCallback((dateRange: [Dayjs, Dayjs] | null) => {
    setFilters((prev) => ({ ...prev, dateRange }))
  }, [])

  return useMemo(
    () => ({
      records,
      loading,
      filters: { regionCode: effectiveRegionCode, dateRange: filters.dateRange },
      setRegionFilter,
      setDateRangeFilter,
      isSuperAdmin,
      ownRegionCode,
      dialogOpen,
      editingRecord,
      openCreate,
      openEdit,
      closeDialog,
      submitRecord,
      removeRecord,
      quickFinishRecord,
      workerSuggestions,
      workerSearchLoading,
      searchWorkers,
    }),
    [
      records,
      loading,
      effectiveRegionCode,
      filters.dateRange,
      setRegionFilter,
      setDateRangeFilter,
      isSuperAdmin,
      ownRegionCode,
      dialogOpen,
      editingRecord,
      openCreate,
      openEdit,
      closeDialog,
      submitRecord,
      removeRecord,
      quickFinishRecord,
      workerSuggestions,
      workerSearchLoading,
      searchWorkers,
    ],
  )
}
