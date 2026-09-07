import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Modal, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface'
import { Archive, BarChart2, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getDateTimeLocale } from '../../i18n'
import { useAppLocale } from '../../i18n/hooks'
import {
  deleteDailyEfficiencyRecord,
  deleteDailyEfficiencyRecords,
  fetchDailyEfficiencyRecords,
} from '../ScannerEfficiency/scannerEfficiencyApi'
import {
  normalizeEfficiencyAttendanceDayRecord,
  resolveEfficiencyAttendanceDayKind,
  toEfficiencyAttendanceDayRecordListItem,
  type EfficiencyAttendanceDayKind,
  type EfficiencyAttendanceDayRecord,
  type EfficiencyAttendanceDayRecordListItem,
} from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'
import { formatInteger, formatNumber } from '../ScannerEfficiency/formatAndParse'
import { showToast } from '../../utils/toast'
import { CompareAnalysisDrawer } from './CompareAnalysisDrawer'

type RecordRow = EfficiencyAttendanceDayRecordListItem & { key: string }

function formatSavedAt(value: string, dateLocale: string, dash: string): string {
  if (!value) return dash
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(dateLocale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatEfficiency(value: number | null, dash: string, unit: string): string {
  if (value == null || !Number.isFinite(value)) return dash
  return `${formatNumber(value, 2)} ${unit}`
}

export default function EfficiencyAttendanceRecordsPage() {
  const { t } = useTranslation('efficiencyRecords')
  const { locale } = useAppLocale()
  const dateLocale = getDateTimeLocale(locale)
  const dash = t('format.dash')
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<RecordRow[]>([])
  const [recordByDate, setRecordByDate] = useState<Map<string, EfficiencyAttendanceDayRecord>>(new Map())
  const [deletingDate, setDeletingDate] = useState<string | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const dayKindMeta = useMemo(
    (): Record<EfficiencyAttendanceDayKind, { label: string; hint: string; className: string }> => ({
      full: {
        label: t('dayKind.full.label'),
        hint: t('dayKind.full.hint'),
        className: 'bg-[var(--admin-accent-soft)] text-[#1f6f68]',
      },
      attendanceOnly: {
        label: t('dayKind.attendanceOnly.label'),
        hint: t('dayKind.attendanceOnly.hint'),
        className: 'bg-amber-50 text-amber-700',
      },
      scanOnly: {
        label: t('dayKind.scanOnly.label'),
        hint: t('dayKind.scanOnly.hint'),
        className: 'bg-red-50 text-red-600',
      },
    }),
    [t],
  )

  const formatSelectedRange = useCallback(
    (dates: string[]): string => {
      if (!dates.length) return ''
      const sorted = [...dates].sort((a, b) => a.localeCompare(b))
      if (sorted.length === 1) return t('format.selectedRangeSingle', { date: sorted[0] })
      return t('format.selectedRangeMulti', {
        start: sorted[0],
        end: sorted[sorted.length - 1],
        count: sorted.length,
      })
    },
    [t],
  )

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetchDailyEfficiencyRecords()
      const nextRecordByDate = new Map<string, EfficiencyAttendanceDayRecord>()
      const nextRows: RecordRow[] = response.items
        .map((item) => {
          const record = normalizeEfficiencyAttendanceDayRecord(item.payload)
          if (!record) return null
          nextRecordByDate.set(record.date, record)
          return {
            key: record.date,
            ...toEfficiencyAttendanceDayRecordListItem(record, item.updatedAt),
          }
        })
        .filter((row): row is RecordRow => row != null)

      setRecordByDate(nextRecordByDate)
      setRows(nextRows)
      setSelectedRowKeys((prev) => prev.filter((key) => nextRecordByDate.has(key)))
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : t('toast.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  const stats = useMemo(() => {
    const withSorting = rows.filter((row) => row.sortingEfficiency != null).length
    const withFrontDesk = rows.filter((row) => row.hasFrontDesk).length
    return {
      total: rows.length,
      withSorting,
      withFrontDesk,
    }
  }, [rows])

  const selectedDates = useMemo(
    () => [...selectedRowKeys].sort((a, b) => a.localeCompare(b)),
    [selectedRowKeys],
  )

  const navigateWithRecords = useCallback(
    (dates: string[]) => {
      const picked = dates
        .map((date) => recordByDate.get(date))
        .filter((record): record is EfficiencyAttendanceDayRecord => record != null)

      if (!picked.length) {
        showToast(t('toast.recordUnavailable'), 'error')
        return
      }

      const pickedDates = new Set(picked.map((record) => record.date))
      const sortedDates = [...pickedDates].sort((a, b) => a.localeCompare(b))
      const rangeStart = sortedDates[0]!
      const rangeEnd = sortedDates[sortedDates.length - 1]!
      const filled = [...recordByDate.values()].filter(
        (record) =>
          !pickedDates.has(record.date) &&
          record.date >= rangeStart &&
          record.date <= rangeEnd &&
          resolveEfficiencyAttendanceDayKind(record.warehouse.daily) === 'attendanceOnly',
      )

      const records = [...picked, ...filled].sort((a, b) => a.date.localeCompare(b.date))
      if (filled.length) {
        showToast(t('toast.autoIncludedAttendanceOnly', { count: filled.length }), 'info')
      }

      navigate('/efficiency', {
        state: {
          restoreDailyRecords: records,
        },
      })
    },
    [navigate, recordByDate, t],
  )

  const handleViewSelected = useCallback(() => {
    if (!selectedDates.length) {
      showToast(t('toast.selectAtLeastOne'), 'warning')
      return
    }
    navigateWithRecords(selectedDates)
  }, [navigateWithRecords, selectedDates, t])

  const handleView = useCallback(
    (date: string) => {
      navigateWithRecords([date])
    },
    [navigateWithRecords],
  )

  const handleDeleteSelected = useCallback(() => {
    if (!selectedDates.length) {
      showToast(t('toast.selectAtLeastOne'), 'warning')
      return
    }

    const rangeLabel = formatSelectedRange(selectedDates)
    Modal.confirm({
      title: t('modal.batchDeleteTitle'),
      content: t('modal.batchDeleteContent', {
        count: selectedDates.length,
        range: rangeLabel ? t('modal.batchDeleteRange', { range: rangeLabel }) : '',
      }),
      okText: t('modal.deleteOk'),
      okButtonProps: { danger: true },
      cancelText: t('modal.cancel'),
      onOk: async () => {
        setBatchDeleting(true)
        try {
          const result = await deleteDailyEfficiencyRecords(selectedDates)
          if (!result.deletedCount) {
            showToast(t('toast.batchDeleteNone'), 'warning')
          } else {
            showToast(t('toast.batchDeleteSuccess', { count: result.deletedCount }), 'success')
          }
          setSelectedRowKeys((prev) => prev.filter((key) => !result.deletedDates.includes(key)))
          await loadRecords()
        } catch (error: unknown) {
          showToast(error instanceof Error ? error.message : t('toast.batchDeleteFailed'), 'error')
        } finally {
          setBatchDeleting(false)
        }
      },
    })
  }, [formatSelectedRange, loadRecords, selectedDates, t])

  const handleDelete = useCallback(
    (date: string) => {
      Modal.confirm({
        title: t('modal.deleteTitle'),
        content: t('modal.deleteContent', { date }),
        okText: t('modal.deleteOk'),
        okButtonProps: { danger: true },
        cancelText: t('modal.cancel'),
        onOk: async () => {
          setDeletingDate(date)
          try {
            await deleteDailyEfficiencyRecord(date)
            showToast(t('toast.deleteSuccess', { date }), 'success')
            setSelectedRowKeys((prev) => prev.filter((key) => key !== date))
            await loadRecords()
          } catch (error: unknown) {
            showToast(error instanceof Error ? error.message : t('toast.deleteFailed'), 'error')
          } finally {
            setDeletingDate(null)
          }
        },
      })
    },
    [loadRecords, t],
  )

  const rowSelection: TableRowSelection<RecordRow> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys.map(String)),
    preserveSelectedRowKeys: true,
  }

  const efficiencyUnit = t('format.efficiencyUnit')

  const columns: ColumnsType<RecordRow> = useMemo(
    () => [
      {
        title: t('col.date'),
        dataIndex: 'date',
        key: 'date',
        width: 120,
        render: (date: string) => <span className="font-medium tabular-nums text-slate-900">{date}</span>,
      },
      {
        title: t('col.kind'),
        dataIndex: 'kind',
        key: 'kind',
        width: 120,
        render: (kind: EfficiencyAttendanceDayKind) => {
          const meta = dayKindMeta[kind]
          return (
            <Tooltip title={meta.hint}>
              <Tag bordered={false} className={`mr-0 ${meta.className}`}>
                {meta.label}
              </Tag>
            </Tooltip>
          )
        },
      },
      {
        title: t('col.volume'),
        dataIndex: 'volume',
        key: 'volume',
        width: 96,
        align: 'right',
        render: (value: number | null) => (
          <span className="tabular-nums text-slate-800">{value != null ? formatInteger(value) : dash}</span>
        ),
      },
      {
        title: t('col.dayEfficiency'),
        dataIndex: 'dayEfficiency',
        key: 'dayEfficiency',
        width: 128,
        render: (value: number | null) => (
          <span className="tabular-nums text-slate-700">{formatEfficiency(value, dash, efficiencyUnit)}</span>
        ),
      },
      {
        title: t('col.openEfficiency'),
        dataIndex: 'openEfficiency',
        key: 'openEfficiency',
        width: 128,
        render: (value: number | null) => (
          <span className="tabular-nums text-slate-700">{formatEfficiency(value, dash, efficiencyUnit)}</span>
        ),
      },
      {
        title: t('col.overallEfficiency'),
        dataIndex: 'overallEfficiency',
        key: 'overallEfficiency',
        width: 128,
        render: (value: number | null) => (
          <span className="tabular-nums text-slate-700">{formatEfficiency(value, dash, efficiencyUnit)}</span>
        ),
      },
      {
        title: t('col.sortingEfficiency'),
        dataIndex: 'sortingEfficiency',
        key: 'sortingEfficiency',
        width: 136,
        render: (value: number | null) => (
          <span className="tabular-nums text-slate-700">{formatEfficiency(value, dash, efficiencyUnit)}</span>
        ),
      },
      {
        title: t('col.frontDeskSaturation'),
        dataIndex: 'hasFrontDesk',
        key: 'hasFrontDesk',
        width: 108,
        render: (value: boolean) =>
          value ? (
            <Tag bordered={false} className="mr-0 bg-[var(--admin-accent-soft)] text-[#1f6f68]">
              {t('col.saved')}
            </Tag>
          ) : (
            <span className="text-slate-400">{dash}</span>
          ),
      },
      {
        title: t('col.savedAt'),
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 168,
        render: (value: string) => (
          <span className="text-sm tabular-nums text-slate-600">{formatSavedAt(value, dateLocale, dash)}</span>
        ),
      },
      {
        title: t('col.actions'),
        key: 'actions',
        width: 148,
        fixed: 'right',
        render: (_, row) => (
          <div className="flex items-center gap-2">
            <Button type="link" className="px-0" icon={<Eye className="h-4 w-4" aria-hidden />} onClick={() => handleView(row.date)}>
              {t('col.view')}
            </Button>
            <Button
              type="link"
              danger
              className="px-0"
              loading={deletingDate === row.date || batchDeleting}
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => handleDelete(row.date)}
            >
              {t('col.delete')}
            </Button>
          </div>
        ),
      },
    ],
    [batchDeleting, dash, dateLocale, dayKindMeta, deletingDate, efficiencyUnit, handleDelete, handleView, t],
  )

  return (
    <div className="admin-page">
      <header className="admin-panel mb-5 overflow-hidden">
        <div className="border-b border-[var(--admin-line)] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="admin-eyebrow">{t('page.eyebrow')}</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{t('page.title')}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{t('page.lead')}</p>
            </div>
            <Button
              type="default"
              icon={<RefreshCw className="h-4 w-4" aria-hidden />}
              loading={loading}
              onClick={() => void loadRecords()}
            >
              {t('page.refresh')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-[var(--admin-line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4 sm:px-6">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t('stats.total')}</div>
            <div className="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums text-slate-950">
              <Archive className="h-5 w-5 text-[#2f8f87]" aria-hidden />
              {stats.total}
            </div>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t('stats.withSorting')}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{stats.withSorting}</div>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t('stats.withFrontDesk')}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{stats.withFrontDesk}</div>
          </div>
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-line)] px-5 py-3 sm:px-6">
          <div className="min-w-0 text-sm text-slate-600">
            {selectedDates.length ? (
              <>
                {t('selection.selected', { count: selectedDates.length })}
                <span className="ml-1 tabular-nums text-slate-800">{formatSelectedRange(selectedDates)}</span>
              </>
            ) : (
              t('selection.hint')
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="default" disabled={!selectedDates.length} onClick={() => setSelectedRowKeys([])}>
              {t('selection.clear')}
            </Button>
            <Tooltip
              title={
                selectedDates.length < 2
                  ? t('selection.compareNeedTwoToSix')
                  : selectedDates.length > 6
                    ? t('selection.compareMaxSix')
                    : undefined
              }
            >
              <Button
                icon={<BarChart2 className="h-4 w-4" aria-hidden />}
                disabled={selectedDates.length < 2 || selectedDates.length > 6}
                onClick={() => setCompareOpen(true)}
              >
                {t('selection.compare')}
              </Button>
            </Tooltip>
            <Button
              type="primary"
              icon={<Eye className="h-4 w-4" aria-hidden />}
              disabled={!selectedDates.length || batchDeleting}
              onClick={handleViewSelected}
            >
              {t('selection.viewSelected')}
            </Button>
            <Button
              danger
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              disabled={!selectedDates.length}
              loading={batchDeleting}
              onClick={handleDeleteSelected}
            >
              {t('selection.deleteSelected')}
            </Button>
          </div>
        </div>

        <Table<RecordRow>
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={rows}
          rowSelection={rowSelection}
          pagination={{
            current: currentPage,
            pageSize,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => t('table.total', { total }),
            onChange: (page, size) => {
              setCurrentPage(page)
              setPageSize(size)
            },
          }}
          locale={{ emptyText: t('table.empty') }}
          scroll={{ x: 1080 }}
        />
      </section>

      <CompareAnalysisDrawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        records={selectedDates
          .map((d) => recordByDate.get(d))
          .filter((r): r is EfficiencyAttendanceDayRecord => r != null)}
      />
    </div>
  )
}
