import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Modal, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface'
import { Archive, BarChart2, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  deleteDailyEfficiencyRecord,
  deleteDailyEfficiencyRecords,
  fetchDailyEfficiencyRecords,
} from '../ScannerEfficiency/scannerEfficiencyApi'
import {
  normalizeEfficiencyAttendanceDayRecord,
  toEfficiencyAttendanceDayRecordListItem,
  type EfficiencyAttendanceDayRecord,
  type EfficiencyAttendanceDayRecordListItem,
} from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'
import { formatInteger, formatNumber } from '../ScannerEfficiency/formatAndParse'
import { showToast } from '../../utils/toast'
import { CompareAnalysisDrawer } from './CompareAnalysisDrawer'

type RecordRow = EfficiencyAttendanceDayRecordListItem & { key: string }

function formatSavedAt(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatEfficiency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${formatNumber(value, 2)} 票/时`
}

function formatSelectedRange(dates: string[]): string {
  if (!dates.length) return ''
  const sorted = [...dates].sort((a, b) => a.localeCompare(b))
  if (sorted.length === 1) return sorted[0]!
  return `${sorted[0]} ~ ${sorted[sorted.length - 1]}（${sorted.length} 天）`
}

export default function EfficiencyAttendanceRecordsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<RecordRow[]>([])
  const [recordByDate, setRecordByDate] = useState<Map<string, EfficiencyAttendanceDayRecord>>(new Map())
  const [deletingDate, setDeletingDate] = useState<string | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)

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
      showToast(error instanceof Error ? error.message : '加载效率考勤记录失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

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
      const records = dates
        .map((date) => recordByDate.get(date))
        .filter((record): record is EfficiencyAttendanceDayRecord => record != null)
        .sort((a, b) => a.date.localeCompare(b.date))

      if (!records.length) {
        showToast('记录数据不可用，请刷新后重试', 'error')
        return
      }

      navigate('/efficiency', {
        state: {
          restoreDailyRecords: records,
        },
      })
    },
    [navigate, recordByDate],
  )

  const handleViewSelected = useCallback(() => {
    if (!selectedDates.length) {
      showToast('请先选择至少一条记录', 'warning')
      return
    }
    navigateWithRecords(selectedDates)
  }, [navigateWithRecords, selectedDates])

  const handleView = useCallback(
    (date: string) => {
      navigateWithRecords([date])
    },
    [navigateWithRecords],
  )

  const handleDeleteSelected = useCallback(() => {
    if (!selectedDates.length) {
      showToast('请先选择至少一条记录', 'warning')
      return
    }

    const rangeLabel = formatSelectedRange(selectedDates)
    Modal.confirm({
      title: '批量删除效率考勤记录',
      content: `确定删除已选的 ${selectedDates.length} 条记录吗？${rangeLabel ? `（${rangeLabel}）` : ''}此操作不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true)
        try {
          const result = await deleteDailyEfficiencyRecords(selectedDates)
          if (!result.deletedCount) {
            showToast('未删除任何记录，可能已被删除', 'warning')
          } else {
            showToast(`已删除 ${result.deletedCount} 条记录`, 'success')
          }
          setSelectedRowKeys((prev) => prev.filter((key) => !result.deletedDates.includes(key)))
          await loadRecords()
        } catch (error: unknown) {
          showToast(error instanceof Error ? error.message : '批量删除失败', 'error')
        } finally {
          setBatchDeleting(false)
        }
      },
    })
  }, [loadRecords, selectedDates])

  const handleDelete = useCallback(
    (date: string) => {
      Modal.confirm({
        title: '删除效率考勤记录',
        content: `确定删除 ${date} 的记录吗？此操作不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          setDeletingDate(date)
          try {
            await deleteDailyEfficiencyRecord(date)
            showToast(`已删除 ${date}`, 'success')
            setSelectedRowKeys((prev) => prev.filter((key) => key !== date))
            await loadRecords()
          } catch (error: unknown) {
            showToast(error instanceof Error ? error.message : '删除失败', 'error')
          } finally {
            setDeletingDate(null)
          }
        },
      })
    },
    [loadRecords],
  )

  const rowSelection: TableRowSelection<RecordRow> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys.map(String)),
    preserveSelectedRowKeys: true,
  }

  const columns: ColumnsType<RecordRow> = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      width: 120,
      render: (date: string) => <span className="font-medium tabular-nums text-slate-900">{date}</span>,
    },
    {
      title: '货量',
      dataIndex: 'volume',
      key: 'volume',
      width: 96,
      align: 'right',
      render: (value: number | null) => (
        <span className="tabular-nums text-slate-800">{value != null ? formatInteger(value) : '—'}</span>
      ),
    },
    {
      title: '日效率',
      dataIndex: 'dayEfficiency',
      key: 'dayEfficiency',
      width: 128,
      render: (value: number | null) => (
        <span className="tabular-nums text-slate-700">{formatEfficiency(value)}</span>
      ),
    },
    {
      title: '开仓效率',
      dataIndex: 'openEfficiency',
      key: 'openEfficiency',
      width: 128,
      render: (value: number | null) => (
        <span className="tabular-nums text-slate-700">{formatEfficiency(value)}</span>
      ),
    },
    {
      title: '总体效率',
      dataIndex: 'overallEfficiency',
      key: 'overallEfficiency',
      width: 128,
      render: (value: number | null) => (
        <span className="tabular-nums text-slate-700">{formatEfficiency(value)}</span>
      ),
    },
    {
      title: '一级分拣效率',
      dataIndex: 'sortingEfficiency',
      key: 'sortingEfficiency',
      width: 136,
      render: (value: number | null) => (
        <span className="tabular-nums text-slate-700">{formatEfficiency(value)}</span>
      ),
    },
    {
      title: '前台饱和度',
      dataIndex: 'hasFrontDesk',
      key: 'hasFrontDesk',
      width: 108,
      render: (value: boolean) =>
        value ? (
          <Tag bordered={false} className="mr-0 bg-[var(--admin-accent-soft)] text-[#1f6f68]">
            已保存
          </Tag>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      title: '保存时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 168,
      render: (value: string) => <span className="text-sm tabular-nums text-slate-600">{formatSavedAt(value)}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 148,
      fixed: 'right',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <Button type="link" className="px-0" icon={<Eye className="h-4 w-4" aria-hidden />} onClick={() => handleView(row.date)}>
            查看
          </Button>
          <Button
            type="link"
            danger
            className="px-0"
            loading={deletingDate === row.date || batchDeleting}
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            onClick={() => handleDelete(row.date)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="admin-page">
      <header className="admin-panel mb-5 overflow-hidden">
        <div className="border-b border-[var(--admin-line)] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="admin-eyebrow">Efficiency Archive</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">效率考勤记录</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
                可多选若干日期组合为一段时间，在效率考勤页按区间展示合并后的计算结果。
              </p>
            </div>
            <Button
              type="default"
              icon={<RefreshCw className="h-4 w-4" aria-hidden />}
              loading={loading}
              onClick={() => void loadRecords()}
            >
              刷新
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-[var(--admin-line)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4 sm:px-6">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">记录总数</div>
            <div className="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums text-slate-950">
              <Archive className="h-5 w-5 text-[#2f8f87]" aria-hidden />
              {stats.total}
            </div>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">含分拣效率</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{stats.withSorting}</div>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">含前台饱和度</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{stats.withFrontDesk}</div>
          </div>
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-line)] px-5 py-3 sm:px-6">
          <div className="min-w-0 text-sm text-slate-600">
            {selectedDates.length ? (
              <>
                已选 <span className="font-semibold tabular-nums text-slate-900">{selectedDates.length}</span> 天：
                <span className="ml-1 tabular-nums text-slate-800">{formatSelectedRange(selectedDates)}</span>
              </>
            ) : (
              '勾选多天后可组合查看一段时间内的效率数据'
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="default"
              disabled={!selectedDates.length}
              onClick={() => setSelectedRowKeys([])}
            >
              清空选择
            </Button>
            <Tooltip
              title={
                selectedDates.length < 2
                  ? '请勾选 2~6 天进行对比'
                  : selectedDates.length > 6
                    ? '最多选 6 天'
                    : undefined
              }
            >
              <Button
                icon={<BarChart2 className="h-4 w-4" aria-hidden />}
                disabled={selectedDates.length < 2 || selectedDates.length > 6}
                onClick={() => setCompareOpen(true)}
              >
                对比分析差异
              </Button>
            </Tooltip>
            <Button
              type="primary"
              icon={<Eye className="h-4 w-4" aria-hidden />}
              disabled={!selectedDates.length || batchDeleting}
              onClick={handleViewSelected}
            >
              查看选中
            </Button>
            <Button
              danger
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              disabled={!selectedDates.length}
              loading={batchDeleting}
              onClick={handleDeleteSelected}
            >
              删除选中
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
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无效率考勤记录，请先在效率考勤页载入数据并保存。' }}
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
