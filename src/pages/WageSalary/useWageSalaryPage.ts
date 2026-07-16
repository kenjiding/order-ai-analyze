// @ts-nocheck
import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { format } from 'date-fns'
import { recalcWageAmounts, summarizeBillingVsActualPayout } from './calculations'
import {
  loadEmployeesFromStorage,
  saveEmployeesToStorage,
  loadRateSettingsFromStorage,
  saveRateSettingsToStorage,
  loadActualWorkerRateSettingsFromStorage,
  saveActualWorkerRateSettingsToStorage,
} from './storage'
import { DEFAULT_RATE_SETTINGS, DEFAULT_ACTUAL_WORKER_RATE_SETTINGS, ROLE_MAP, ROLES } from './constants'
import {
  buildRateSettingsExportRows,
  buildWageExportFileName,
  deriveAttendanceDateRangeLabel,
  buildWeeklyBillingSummaryRows,
  buildDailyRawAttendanceExportRows,
  buildEmployeeAttendanceDetailExportRows,
} from './wageExport'
import { generateId } from '../../utils/generateId'
import { showToast } from '../../utils/toast'
import { confirmDialog } from '../../utils/confirmDialog'
import {
  formatDateDisplay,
  formatWorkdayDisplay,
  convertDateToStandard,
} from './dateUtils'
import { transformSheetRowsToUploadedData } from './uploadTransform'
import {
  normalizeUploadedRowsForSubmit,
  buildWageRowsFromNormalized,
} from './uploadSubmit'
import { parseFinanceLedgerRows } from '../../payroll/financeLedgerMapping'
import { fetchZktAttendance } from '../../api/zktAttendanceApi'
import { toZktAttendanceInput } from '../../imile/zktAttendanceSettings'
import { mapZktTimeCardToAttendanceSheetRows } from '../../payroll/zktTimeCardSheetMapping'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useAuthStore } from '../../stores/authStore'
import {
  reconcileFinanceWithWageRecords,
  buildReconciliationExportRows,
} from '../../payroll/financeWageReconciliation'

/** 与上传解析一致的 read 选项；导出合并原始表时复用 */
const WAGE_XLSX_READ_OPTS = {
  cellDates: false,
  raw: false,
  dateNF: 'dd/mm/yyyy',
} as const

type ImportRawSnapshot =
  | { kind: 'binary'; buffer: ArrayBuffer }
  | { kind: 'csv'; text: string }

function cloneImportRawSnapshot(raw: ImportRawSnapshot): ImportRawSnapshot {
  if (raw.kind === 'binary') {
    return { kind: 'binary', buffer: raw.buffer.slice(0) }
  }
  return { kind: 'csv', text: raw.text }
}

function parseImportWorkbook(raw: ImportRawSnapshot) {
  if (raw.kind === 'csv') {
    return XLSX.read(raw.text, { type: 'string', ...WAGE_XLSX_READ_OPTS })
  }
  return XLSX.read(raw.buffer, { type: 'array', ...WAGE_XLSX_READ_OPTS })
}

/** 工作表名 Excel 上限 31；避免与已有重名 */
function uniqueSheetName(base: string, used: Set<string>): string {
  const n = String(base || 'Sheet').replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet'
  if (!used.has(n)) {
    used.add(n)
    return n
  }
  let i = 1
  while (i < 10000) {
    const suffix = `_${i}`
    const trimmed = n.slice(0, Math.max(1, 31 - suffix.length))
    const candidate = `${trimmed}${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    i += 1
  }
  const fallback = `Sheet_${Date.now()}`.slice(0, 31)
  used.add(fallback)
  return fallback
}

function cloneWorksheetForAppend(ws) {
  // raw:true 会保留 Excel 日期序列号（如 46155），写出后无单元格格式即显示为数字
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
    dateNF: WAGE_XLSX_READ_OPTS.dateNF,
  })
  return XLSX.utils.aoa_to_sheet(rows)
}

function appendOriginalWorkbookSheets(targetBook, sourceBook) {
  const used = new Set<string>(targetBook.SheetNames)
  for (const sheetName of sourceBook.SheetNames) {
    const orig = sourceBook.Sheets[sheetName]
    if (!orig) continue
    const displayBase = String(sheetName || '').trim() || '原始数据'
    const name = uniqueSheetName(`原始_${displayBase}`, used)
    try {
      const copy = cloneWorksheetForAppend(orig)
      XLSX.utils.book_append_sheet(targetBook, copy, name)
    } catch (e) {
      console.warn('跳过无法合并的工作表:', sheetName, e)
    }
  }
}

export function useWageSalaryPage() {
  const { zktAttendance } = useAppSettings()
  const authUserId = useAuthStore((s) => s.user?.id ?? null)
  const [activeTab, setActiveTab] = useState('upload')
  const [employees, setEmployees] = useState([])
  const [wageRecords, setWageRecords] = useState([])
  const [uploadedData, setUploadedData] = useState([])
  /** 当前选择文件对应的原始字节/文本；提交成功后复制到 committedImportRaw */
  const [pendingImportRaw, setPendingImportRaw] = useState<ImportRawSnapshot | null>(null)
  /** 最近一次「计算薪资」成功时对应的上传原文件，供导出时作为后续 Sheet 合并 */
  const [committedImportRaw, setCommittedImportRaw] = useState<ImportRawSnapshot | null>(null)
  /** API 模式计算薪资成功后保留的有效考勤行，供导出「每日原始考勤记录」 */
  const [committedApiAttendanceRows, setCommittedApiAttendanceRows] = useState<
    Record<string, string>[]
  >([])

  const [financeLedgerRows, setFinanceLedgerRows] = useState([])
  const [financeSourceFileName, setFinanceSourceFileName] = useState('')

  const [isUploading, setIsUploading] = useState(false)
  const [isLoadingZktAttendance, setIsLoadingZktAttendance] = useState(false)
  const [wageApiDateRange, setWageApiDateRange] = useState(null)

  const [editingEmployeeId, setEditingEmployeeId] = useState(null)
  const [tempRole, setTempRole] = useState('')
  const [rowEditingData, setRowEditingData] = useState({})

  const [searchQuery, setSearchQuery] = useState('')
  const [searchStartDate, setSearchStartDate] = useState('')
  const [searchEndDate, setSearchEndDate] = useState('')
  const [searchRole, setSearchRole] = useState('')

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [showRateSettings, setShowRateSettings] = useState(false)
  const [showActualWorkerRates, setShowActualWorkerRates] = useState(false)

  const [rateSettings, setRateSettings] = useState(() =>
    JSON.parse(JSON.stringify(DEFAULT_RATE_SETTINGS)),
  )

  const [actualWorkerRateSettings, setActualWorkerRateSettings] = useState(() =>
    JSON.parse(JSON.stringify(DEFAULT_ACTUAL_WORKER_RATE_SETTINGS)),
  )

  useEffect(() => {
    if (!authUserId) return
    void (async () => {
      const [emps, rates, actual] = await Promise.all([
        loadEmployeesFromStorage(),
        loadRateSettingsFromStorage(DEFAULT_RATE_SETTINGS),
        loadActualWorkerRateSettingsFromStorage(DEFAULT_ACTUAL_WORKER_RATE_SETTINGS),
      ])
      setEmployees(emps)
      setRateSettings(rates)
      setActualWorkerRateSettings(actual)
    })()
  }, [authUserId])

  const statistics = useMemo(() => {
    if (!wageRecords.length) return null
    const totalWages = wageRecords.reduce((s, r) => s + (r.totalWage || 0), 0)
    const totalHours = wageRecords.reduce((s, r) => s + (r.totalHoursDecimal || 0), 0)
    return { totalWages, totalHours, totalRecords: wageRecords.length }
  }, [wageRecords])


  const persistRateSettings = useCallback(
    async (settings) => {
      try {
        await saveRateSettingsToStorage(settings)
        setRateSettings(settings)
        setWageRecords((prev) => prev.map((r) => recalcWageAmounts({ ...r }, settings)))
        showToast('时薪设置已保存', 'success')
      } catch (error) {
        console.error('保存时薪设置失败:', error)
        showToast('保存时薪设置失败', 'error')
      }
    },
    [showToast],
  )

  const resetRateSettings = useCallback(async () => {
    setRateSettings(DEFAULT_RATE_SETTINGS)
    try {
      await saveRateSettingsToStorage(DEFAULT_RATE_SETTINGS)
    } catch (e) {
      console.error(e)
    }
    setWageRecords((prev) =>
      prev.map((r) => recalcWageAmounts({ ...r }, DEFAULT_RATE_SETTINGS)),
    )
    showToast('已重置为默认时薪', 'success')
  }, [showToast])

  const persistActualWorkerRateSettings = useCallback(
    async (settings) => {
      try {
        await saveActualWorkerRateSettingsToStorage(settings)
        setActualWorkerRateSettings(settings)
        showToast('实际时薪设置已保存', 'success')
      } catch (error) {
        console.error('保存实际时薪设置失败:', error)
        showToast('保存实际时薪设置失败', 'error')
      }
    },
    [showToast],
  )

  const resetActualWorkerRateSettings = useCallback(async () => {
    const defaults = JSON.parse(JSON.stringify(DEFAULT_ACTUAL_WORKER_RATE_SETTINGS))
    setActualWorkerRateSettings(defaults)
    try {
      await saveActualWorkerRateSettingsToStorage(defaults)
    } catch (e) {
      console.error(e)
    }
    showToast('已重置实际时薪为默认', 'success')
  }, [showToast])

  const handleFileUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    try {
      const fileExtension = file.name.split('.').pop().toLowerCase()
      let jsonData = []

      if (fileExtension === 'csv') {
        const text = await file.text()
        setPendingImportRaw({ kind: 'csv', text })
        const workbook = XLSX.read(text, { type: 'string', ...WAGE_XLSX_READ_OPTS })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]
        jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false })
      } else {
        const data = await file.arrayBuffer()
        setPendingImportRaw({ kind: 'binary', buffer: data.slice(0) })
        const workbook = XLSX.read(data, { type: 'array', ...WAGE_XLSX_READ_OPTS })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]
        jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false })
      }

      const employeeRoleMap = {}
      employees.forEach((emp) => {
        employeeRoleMap[emp.employeeId] = emp.role
      })

      const sortedData = transformSheetRowsToUploadedData(jsonData, employees)

      setUploadedData(sortedData)

      const matchedCount = sortedData.filter((item) => employeeRoleMap[item.employeeId]).length
      const newCount = sortedData.length - matchedCount

      if (matchedCount > 0 && newCount > 0) {
        showToast(
          `成功读取 ${sortedData.length} 条记录（${matchedCount} 条已匹配角色，${newCount} 条新员工）`,
          'success',
        )
      } else if (matchedCount > 0) {
        showToast(`成功读取 ${sortedData.length} 条记录（全部已匹配角色）`, 'success')
      } else {
        showToast(`成功读取 ${sortedData.length} 条记录（全部为新员工）`, 'success')
      }
    } catch (error) {
      console.error('读取文件失败:', error)
      setPendingImportRaw(null)
      showToast('读取文件失败，请确保文件格式正确', 'error')
    }

    event.target.value = ''
  }

  const handleZktApiFetch = async (startDate, endDate) => {
    if (!startDate || !endDate) {
      showToast('请选择有效的日期区间', 'error')
      return
    }
    if (!zktAttendance.username.trim() || !zktAttendance.password) {
      showToast('请先在系统设置中配置 ZKT 考勤 API 账号与密码', 'error')
      return
    }

    setIsLoadingZktAttendance(true)
    try {
      const zktInput = toZktAttendanceInput(zktAttendance)
      const requestParams = {
        username: zktInput.username,
        departmentId: zktInput.departmentId,
        startDate,
        endDate,
        zktQuery: {
          start_date: startDate,
          end_date: endDate,
          departments: zktInput.departmentId,
          areas: '-1',
          groups: '-1',
          employees: '-1',
          page_size: 10_000,
        },
      }
      console.log('[工资结算] 获取考勤 — 请求参数', requestParams)

      const result = await fetchZktAttendance({
        zktAttendance,
        startDate,
        endDate,
      })

      if (result.count > 0 && result.fetched < result.count) {
        throw new Error(`ZKT 考勤数据不完整：count=${result.count}，实际拉取 ${result.fetched} 条`)
      }

      const sheetRows = mapZktTimeCardToAttendanceSheetRows(result.data)
      const sortedData = transformSheetRowsToUploadedData(sheetRows, employees)

      if (!sortedData.length) {
        showToast(
          `ZKT 返回 ${result.count} 条，但没有可计算薪资的有效工时（工作时长/总时长）记录`,
          'warning',
        )
        return
      }

      setUploadedData(sortedData)
      setPendingImportRaw(null)
      setWageApiDateRange([startDate, endDate])

      const employeeRoleMap = {}
      employees.forEach((emp) => {
        employeeRoleMap[emp.employeeId] = emp.role
      })
      const matchedCount = sortedData.filter((item) => employeeRoleMap[item.employeeId]).length
      const newCount = sortedData.length - matchedCount

      if (matchedCount > 0 && newCount > 0) {
        showToast(
          `已载入 ${sortedData.length} 条（count=${result.count}，${matchedCount} 条已匹配角色，${newCount} 条新员工）`,
          'success',
        )
      } else if (matchedCount > 0) {
        showToast(`已载入 ${sortedData.length} 条（count=${result.count}，全部已匹配角色）`, 'success')
      } else {
        showToast(`已载入 ${sortedData.length} 条（count=${result.count}，全部为新员工）`, 'success')
      }
    } catch (error) {
      console.error('ZKT 考勤拉取失败:', error)
      showToast(error?.message || 'ZKT 考勤拉取失败', 'error')
    } finally {
      setIsLoadingZktAttendance(false)
    }
  }

  const handleSubmitUpload = async () => {
    if (uploadedData.length === 0) {
      showToast('请先上传文件或拉取考勤 API 数据', 'error')
      return
    }

    setIsUploading(true)
    try {
      const { validationErrors, recordsToSubmit } = normalizeUploadedRowsForSubmit(uploadedData)

      if (validationErrors.length > 0) {
        const errorMsg =
          `数据验证失败，发现 ${validationErrors.length} 条无效记录：\n\n` +
          validationErrors
            .slice(0, 10)
            .map(
              (err) =>
                `第 ${err.index} 行 - ${err.label} (${err.employeeId}): ${err.error}`,
            )
            .join('\n') +
          (validationErrors.length > 10 ? `\n...还有 ${validationErrors.length - 10} 条错误` : '')
        showToast(errorMsg, 'error')
        setIsUploading(false)
        return
      }

      const computed = buildWageRowsFromNormalized(recordsToSubmit, rateSettings)

      setEmployees((prev) => {
        const next = [...prev]
        for (const rec of recordsToSubmit) {
          const nick = String(rec.nickname ?? '').trim()
          const idx = next.findIndex(
            (e) => e.employeeId === rec.employeeId && String(e.nickname ?? '').trim() === nick,
          )
          const payload = {
            employeeId: rec.employeeId,
            name: rec.name || '',
            surname: rec.surname || '',
            nickname: rec.nickname || '',
            department: rec.department || '',
            role: rec.role || 'worker',
          }
          if (idx === -1) {
            next.push({
              _id: generateId(),
              ...payload,
              createdAt: new Date().toISOString(),
            })
          } else {
            next[idx] = { ...next[idx], ...payload }
          }
        }
        void saveEmployeesToStorage(next).catch((err) => console.error('保存员工列表失败:', err))
        return next
      })

      setWageRecords(computed)
      setCurrentPage(1)
      if (pendingImportRaw) {
        setCommittedImportRaw(cloneImportRawSnapshot(pendingImportRaw))
        setCommittedApiAttendanceRows([])
      } else {
        setCommittedImportRaw(null)
        setCommittedApiAttendanceRows(buildDailyRawAttendanceExportRows(uploadedData))
      }
      setPendingImportRaw(null)
      setUploadedData([])
      showToast(`计算完成：生成 ${computed.length} 条工资记录（不累加历史）。`, 'success')
    } catch (error) {
      console.error('上传失败:', error)
      showToast(`上传失败: ${error.message || '处理错误'}`, 'error')
    } finally {
      setIsUploading(false)
    }
  }

  const handleUpdateRecordField = (recordId, fieldUpdates) => {
    setWageRecords((prev) =>
      prev.map((r) => {
        if (r._id !== recordId) return r
        const merged = { ...r, ...fieldUpdates }
        return recalcWageAmounts(merged, rateSettings)
      }),
    )
    showToast('更新成功', 'success')
  }

  const startRowEditing = (record) => {
    setRowEditingData({
      [record._id]: {
        date: convertDateToStandard(record.date),
        workday: record.workday || '',
        totalHours: record.workHours ?? record.totalHours ?? '',
        role: record.role,
        isPublicHoliday: record.isPublicHoliday || false,
        isSorting: record.isSorting || false,
      },
    })
  }

  const cancelRowEditing = (recordId) => {
    setRowEditingData((prev) => {
      const newState = { ...prev }
      delete newState[recordId]
      return newState
    })
  }

  const saveRowEditing = (recordId) => {
    const editData = rowEditingData[recordId]
    if (!editData) return
    handleUpdateRecordField(recordId, {
      date: editData.date,
      workday: editData.workday,
      totalHours: editData.totalHours,
      workHours: editData.totalHours,
      role: editData.role,
      isPublicHoliday: editData.isPublicHoliday,
      isSorting: editData.isSorting,
    })
    cancelRowEditing(recordId)
  }

  const handleDeleteRecord = async (recordId) => {
    const confirmed = await confirmDialog({
      title: '删除工资记录',
      content: '确定要删除这条记录吗？',
      okText: '删除',
      danger: true,
    })
    if (!confirmed) return
    setWageRecords((prev) => prev.filter((r) => r._id !== recordId))
    showToast('删除成功', 'success')
  }

  const handleUpdateEmployeeRole = (employeeRecordId, newRole) => {
    setEmployees((prev) => {
      const next = prev.map((e) => (e._id === employeeRecordId ? { ...e, role: newRole } : e))
      void saveEmployeesToStorage(next).catch((err) => console.error('保存员工列表失败:', err))
      return next
    })
    showToast('员工角色更新成功', 'success')
    setEditingEmployeeId(null)
  }

  const handleDeleteEmployee = async (employee) => {
    const { employeeId, nickname } = employee
    const nick = String(nickname ?? '').trim()
    const display = nick || String(employeeId)
    const confirmed = await confirmDialog({
      title: '删除员工',
      content: `确定要删除员工 ${display} (${employeeId}${nick ? ` / 昵称 ${nick}` : ''}) 吗？将同时移除当前工资表中对应昵称的薪资记录。`,
      okText: '删除',
      danger: true,
    })
    if (!confirmed) return
    setEmployees((prev) => {
      const next = prev.filter((e) => e._id !== employee._id)
      void saveEmployeesToStorage(next).catch((err) => console.error('保存员工列表失败:', err))
      return next
    })
    setWageRecords((prev) =>
      prev.filter(
        (r) =>
          String(r.employeeId) !== String(employeeId) ||
          String(r.nickname ?? '').trim() !== nick,
      ),
    )
    showToast('员工删除成功', 'success')
  }

  const handleUpdateUploadedRole = (index, newRole) => {
    setUploadedData((prev) => prev.map((item, i) => (i === index ? { ...item, role: newRole } : item)))
  }

  const handleDayOptionChange = (index, option) => {
    setUploadedData((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item
        return {
          ...item,
          weekendOption: option,
        }
      }),
    )
  }

  const handleDeleteUploadedRow = (index) => {
    setUploadedData((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) {
        setPendingImportRaw(null)
      }
      return next
    })
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, searchStartDate, searchEndDate, searchRole])

  const filteredWageRecords = useMemo(() => {
    let filtered = [...wageRecords]
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (r) =>
          String(r.employeeId).toLowerCase().includes(q) ||
          String(r.name || '').toLowerCase().includes(q) ||
          String(r.nickname || '').toLowerCase().includes(q) ||
          String(r.surname || '').toLowerCase().includes(q),
      )
    }
    if (searchStartDate || searchEndDate) {
      filtered = filtered.filter((r) => {
        const recordDate = new Date(r.date)
        const recordDateStr = format(recordDate, 'yyyy-MM-dd')
        if (searchStartDate && searchEndDate) {
          return recordDateStr >= searchStartDate && recordDateStr <= searchEndDate
        }
        if (searchStartDate) return recordDateStr >= searchStartDate
        if (searchEndDate) return recordDateStr <= searchEndDate
        return true
      })
    }
    if (searchRole) filtered = filtered.filter((r) => r.role === searchRole)
    return filtered
  }, [wageRecords, searchQuery, searchStartDate, searchEndDate, searchRole])

  const billingVsActualSummary = useMemo(() => {
    if (!filteredWageRecords.length) return null
    return summarizeBillingVsActualPayout(filteredWageRecords, actualWorkerRateSettings)
  }, [filteredWageRecords, actualWorkerRateSettings])

  const reconciliationResult = useMemo(() => {
    if (!financeLedgerRows.length || !wageRecords.length) return null
    return reconcileFinanceWithWageRecords(financeLedgerRows, wageRecords)
  }, [financeLedgerRows, wageRecords])

  const paginatedRecords = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize
    return filteredWageRecords.slice(startIdx, startIdx + pageSize)
  }, [filteredWageRecords, currentPage, pageSize])

  const totalPages =
    filteredWageRecords.length === 0 ? 0 : Math.ceil(filteredWageRecords.length / pageSize)

  const handleExport = () => {
    if (filteredWageRecords.length === 0) {
      showToast('没有可导出的数据', 'error')
      return
    }

    /** 按「昵称」合并为多行；昵称为空时用人员编号分组，避免误把不同人合成一行 */
    type NickAgg = {
      nickname: string
      name: string
      surname: string
      totalHoursDecimal: number
      totalWage: number
    }
    const nickMap = new Map<string, NickAgg>()

    for (const r of filteredWageRecords) {
      const nickTrim = String(r.nickname ?? '').trim()
      const groupKey = nickTrim || `__emp_${String(r.employeeId ?? '')}`
      const hours = Number(r.totalHoursDecimal) || 0
      const wage = Number(r.totalWage) || 0
      const nm = String(r.name ?? '').trim()
      const sur = String(r.surname ?? '').trim()

      const prev = nickMap.get(groupKey)
      if (!prev) {
        nickMap.set(groupKey, {
          nickname: nickTrim,
          name: nm,
          surname: sur,
          totalHoursDecimal: hours,
          totalWage: wage,
        })
      } else {
        prev.totalHoursDecimal += hours
        prev.totalWage += wage
        if (!prev.name && nm) prev.name = nm
        if (!prev.surname && sur) prev.surname = sur
      }
    }

    const mergedRows = Array.from(nickMap.values()).sort((a, b) => {
      const ka = (a.nickname || a.name || '').toLowerCase()
      const kb = (b.nickname || b.name || '').toLowerCase()
      return ka.localeCompare(kb, 'zh-CN')
    })

    const totalHoursAll = mergedRows.reduce((s, row) => s + row.totalHoursDecimal, 0)
    const totalWageAll = mergedRows.reduce((s, row) => s + row.totalWage, 0)

    const exportData = mergedRows.map((row) => ({
      姓名: row.name || '',
      昵称: row.nickname || '',
      姓氏: row.surname || '',
      总时长: Number(row.totalHoursDecimal.toFixed(2)),
      总价格: Number(row.totalWage.toFixed(2)),
    }))

    exportData.push({
      姓名: '合计',
      昵称: '',
      姓氏: '',
      总时长: Number(totalHoursAll.toFixed(2)),
      总价格: Number(totalWageAll.toFixed(2)),
    })

    const worksheet = XLSX.utils.json_to_sheet(exportData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '工资数据')

    const rateSheetRows = buildRateSettingsExportRows(rateSettings, ROLE_MAP, ROLES)

    const weeklySummaryRows = buildWeeklyBillingSummaryRows(
      filteredWageRecords,
      actualWorkerRateSettings,
    )

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(weeklySummaryRows),
      '周对账汇总',
    )

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(rateSheetRows),
      '时薪标准',
    )

    const attendanceDetailSource =
      committedApiAttendanceRows.length > 0 ? committedApiAttendanceRows : filteredWageRecords
    const employeeAttendanceDetailRows =
      buildEmployeeAttendanceDetailExportRows(attendanceDetailSource)
    if (employeeAttendanceDetailRows.length > 0) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(employeeAttendanceDetailRows),
        '员工考勤详情',
      )
    }

    if (committedApiAttendanceRows.length > 0) {
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(committedApiAttendanceRows),
        '每日原始考勤记录',
      )
    }

    if (committedImportRaw) {
      try {
        const sourceWb = parseImportWorkbook(committedImportRaw)
        appendOriginalWorkbookSheets(workbook, sourceWb)
      } catch (e) {
        console.error('合并原始上传表失败:', e)
      }
    }

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const dateRangeLabel = deriveAttendanceDateRangeLabel(wageRecords)
    const fileName = buildWageExportFileName(dateRangeLabel)
    saveAs(blob, fileName)

    const attendanceExtras: string[] = []
    if (employeeAttendanceDetailRows.length > 0) attendanceExtras.push('员工考勤详情')
    if (committedApiAttendanceRows.length > 0) attendanceExtras.push('每日原始考勤记录')
    const exportParts = [
      committedImportRaw ? '原始上传工作表' : '',
      ...attendanceExtras,
    ].filter(Boolean)
    const exportExtra = exportParts.length > 0 ? `（已附带${exportParts.join('与')}）` : ''
    showToast(`导出成功${exportExtra}`, 'success')
  }

  const handleClearUploadedData = () => {
    setUploadedData([])
    setPendingImportRaw(null)
    setWageApiDateRange(null)
  }

  const handleFinanceFileUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    try {
      const fileExtension = file.name.split('.').pop().toLowerCase()
      let jsonData = []

      if (fileExtension === 'csv') {
        const text = await file.text()
        const workbook = XLSX.read(text, { type: 'string', ...WAGE_XLSX_READ_OPTS })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]
        jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false })
      } else {
        const data = await file.arrayBuffer()
        const workbook = XLSX.read(data, { type: 'array', ...WAGE_XLSX_READ_OPTS })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]
        jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false })
      }

      const { rows, parseErrors } = parseFinanceLedgerRows(jsonData)
      setFinanceLedgerRows(rows)
      setFinanceSourceFileName(file.name)

      if (parseErrors.length > 0) {
        const errorMsg =
          `财务流水解析：有效 ${rows.length} 条，跳过 ${parseErrors.length} 条无效记录：\n\n` +
          parseErrors
            .slice(0, 8)
            .map((err) => `第 ${err.rowIndex} 行 - ${err.personName}: ${err.error}`)
            .join('\n') +
          (parseErrors.length > 8 ? `\n...还有 ${parseErrors.length - 8} 条错误` : '')
        showToast(errorMsg, rows.length > 0 ? 'success' : 'error')
      } else {
        showToast(`成功读取 ${rows.length} 条财务流水记录`, 'success')
      }
    } catch (error) {
      console.error('读取财务流水失败:', error)
      setFinanceLedgerRows([])
      setFinanceSourceFileName('')
      showToast('读取财务流水失败，请确保文件格式正确', 'error')
    }

    event.target.value = ''
  }

  const handleClearFinanceData = () => {
    setFinanceLedgerRows([])
    setFinanceSourceFileName('')
  }

  const handleExportReconciliation = () => {
    if (!reconciliationResult || reconciliationResult.rows.length === 0) {
      showToast('没有可导出的差异对比数据', 'error')
      return
    }

    const exportRows = buildReconciliationExportRows(reconciliationResult)
    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '差异对比')

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const dateRangeLabel = deriveAttendanceDateRangeLabel(wageRecords)
    const baseName = dateRangeLabel ? `差异对比_${dateRangeLabel}` : '差异对比'
    saveAs(blob, `${baseName}.xlsx`)
    showToast('差异对比导出成功', 'success')
  }

  return {
    activeTab,
    setActiveTab,
    employees,
    wageRecords,
    uploadedData,
    isUploading,
    editingEmployeeId,
    setEditingEmployeeId,
    tempRole,
    setTempRole,
    rowEditingData,
    setRowEditingData,
    searchQuery,
    setSearchQuery,
    searchStartDate,
    setSearchStartDate,
    searchEndDate,
    setSearchEndDate,
    searchRole,
    setSearchRole,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    showRateSettings,
    setShowRateSettings,
    showActualWorkerRates,
    setShowActualWorkerRates,
    rateSettings,
    actualWorkerRateSettings,
    setActualWorkerRateSettings,
    persistActualWorkerRateSettings,
    resetActualWorkerRateSettings,
    billingVsActualSummary,
    setRateSettings,
    statistics,
    roleMap: ROLE_MAP,
    roles: [...ROLES],
    persistRateSettings,
    resetRateSettings,
    handleFileUpload,
    handleZktApiFetch,
    isLoadingZktAttendance,
    wageApiDateRange,
    setWageApiDateRange,
    handleSubmitUpload,
    startRowEditing,
    cancelRowEditing,
    saveRowEditing,
    handleDeleteRecord,
    handleUpdateEmployeeRole,
    handleDeleteEmployee,
    handleUpdateUploadedRole,
    handleDayOptionChange,
    handleDeleteUploadedRow,
    filteredWageRecords,
    paginatedRecords,
    totalPages,
    handleExport,
    handleClearUploadedData,
    handleFinanceFileUpload,
    financeLedgerRows,
    financeSourceFileName,
    handleClearFinanceData,
    reconciliationResult,
    handleExportReconciliation,
    formatDate: formatDateDisplay,
    formatWorkday: formatWorkdayDisplay,
  }
}
