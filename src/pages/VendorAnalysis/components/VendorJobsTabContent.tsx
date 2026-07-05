import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import type { JobStatus, PublicJob } from '../vendorAnalysisApi'
import { ALL_METRIC_KEYS, metricDisplayLabel } from '../metricsRegistry'

/** 任务提交时固化的指标选择（只读展示）；老任务未落 metricKeys 视为全量 */
function MetricKeysCell({ job }: { job: PublicJob }) {
  const keys = Array.isArray(job.payload.metricKeys)
    ? (job.payload.metricKeys as unknown[]).filter((k): k is string => typeof k === 'string')
    : null
  if (!keys) return <Tag className="mr-0" color="default">全部指标</Tag>
  if (keys.length === 0) return <span className="text-slate-400">—</span>
  if (keys.length >= ALL_METRIC_KEYS.length) return <Tag className="mr-0" color="blue">全部指标</Tag>
  const labels = keys.map(metricDisplayLabel).join('、')
  return (
    <Tooltip title={labels}>
      <span className="text-slate-600 line-clamp-2">{labels}</span>
    </Tooltip>
  )
}

type Props = {
  jobs: PublicJob[]
  isLoading: boolean
  loadingJobId: string | null
  onRefresh: () => void
  onLoadResults: (jobId: string) => void
  onEdit: (job: PublicJob) => void
  /** 打开分享链接抽屉；无分享权限时为 undefined（不渲染「分享」按钮） */
  onShare?: (job: PublicJob) => void
  onCancel: (jobId: string) => void
  onDelete: (jobId: string) => void
  onRetry: (job: PublicJob) => void
  /** 站点 code → 名称映射，用于「站点」列回填名称 */
  stationNameMap?: Record<string, string>
  /** 队列标题行右侧的额外操作（如「新建分析任务」按钮），与「刷新」同排展示 */
  headerAction?: ReactNode
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} 小时前`
  return `${Math.floor(diffHr / 24)} 天前`
}

function getStationCodes(job: PublicJob): string[] {
  return Array.isArray(job.payload.stationCodes) ? (job.payload.stationCodes as string[]) : []
}

function getDateRangeLabel(job: PublicJob): string {
  const start = typeof job.payload.startTime === 'string' ? job.payload.startTime.slice(0, 10) : ''
  const end = typeof job.payload.endTime === 'string' ? job.payload.endTime.slice(0, 10) : ''
  return start && end ? `${start} ~ ${end}` : '—'
}

function getReferenceDate(job: PublicJob): string {
  return typeof job.payload.referenceDate === 'string' && job.payload.referenceDate ? job.payload.referenceDate : '—'
}

function getProgress(job: PublicJob): string {
  const p = job.progress
  const phase = typeof p.phase === 'string' ? p.phase : ''
  const message = typeof p.message === 'string' ? p.message : ''
  const percent = typeof p.percent === 'number' ? `${p.percent}%` : ''
  return [phase && `[${phase}]`, message, percent].filter(Boolean).join(' ') || '—'
}

const STATUS_CFG: Record<JobStatus, { label: string; color: 'warning' | 'processing' | 'success' | 'error' | 'default' }> = {
  pending: { label: '等待中', color: 'warning' },
  running: { label: '处理中', color: 'processing' },
  succeeded: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
}

function buildColumns(
  loadingJobId: string | null,
  onLoadResults: (jobId: string) => void,
  onEdit: (job: PublicJob) => void,
  onShare: ((job: PublicJob) => void) | undefined,
  onCancel: (jobId: string) => void,
  onDelete: (jobId: string) => void,
  onRetry: (job: PublicJob) => void,
  stationNameMap: Record<string, string>,
): ColumnsType<PublicJob> {
  return [
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      width: 108,
      render: (status: JobStatus) => {
        const cfg = STATUS_CFG[status] ?? STATUS_CFG.cancelled
        return (
          <Tag color={cfg.color} className="mr-0">
            {status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {cfg.label}
          </Tag>
        )
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 220,
      render: (_, job) => {
        if (job.status === 'running') {
          const percent = typeof job.progress.percent === 'number' ? job.progress.percent : null
          return (
            <div className="min-w-[180px]">
              <div className="mb-1 text-slate-500">{getProgress(job)}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${percent ?? 20}%` }}
                />
              </div>
            </div>
          )
        }
        if (job.status === 'failed' && job.error) {
          return (
            <span className="text-red-600 line-clamp-2" title={job.error}>
              {job.error}
            </span>
          )
        }
        if (job.status === 'succeeded') {
          return <span className="text-green-600">数据已就绪</span>
        }
        if (job.status === 'pending') {
          return <span className="text-slate-400">等待 Worker…</span>
        }
        return <span className="text-slate-400">—</span>
      },
    },
    {
      title: '提交时间',
      key: 'createdAt',
      dataIndex: 'createdAt',
      width: 120,
      render: (createdAt: string) => <span className="text-slate-500">{formatRelativeTime(createdAt)}</span>,
    },
    {
      title: '数据参考日期',
      key: 'referenceDate',
      width: 120,
      render: (_, job) => <span className="text-slate-600">{getReferenceDate(job)}</span>,
    },
    {
      title: '站点',
      key: 'stations',
      width: 80,
      render: (_, job) => {
        const codes = getStationCodes(job)
        // 回填站点名称：优先用全局站点列表映射，缺失时兜底展示 code
        const names = codes.map((code) => stationNameMap[code] ?? code)
        return <span className="text-slate-600" title={names.join('、')}>{names.length > 0 ? names.join('、') : '—'}</span>
      },
    },
    {
      title: '客诉成立量时间',
      key: 'dateRange',
      width: 210,
      render: (_, job) => <span className="text-slate-500">{getDateRangeLabel(job)}</span>,
    },
    {
      title: '指标配置',
      key: 'metricKeys',
      width: 200,
      render: (_, job) => <MetricKeysCell job={job} />,
    },
    {
      title: '完成时间',
      key: 'finishedAt',
      dataIndex: 'finishedAt',
      width: 120,
      render: (finishedAt: string | null) =>
        finishedAt ? (
          <span className="text-slate-500">{formatRelativeTime(finishedAt)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 340,
      fixed: 'right',
      render: (_, job) => {
        const isLoadingThis = loadingJobId === job.id
        const isLoadingOther = loadingJobId != null && !isLoadingThis
        return (
          <div className="flex flex-wrap gap-2">
            {job.status === 'succeeded' && (
              <Button
                type="primary"
                loading={isLoadingThis}
                disabled={isLoadingOther}
                onClick={() => onLoadResults(job.id)}
              >
                {isLoadingThis ? '加载中…' : '查看数据'}
              </Button>
            )}
            {job.status === 'failed' && (
              <Button
                disabled={isLoadingOther}
                onClick={() => onRetry(job)}
                className="!border-orange-300 !bg-orange-50 !text-orange-700 hover:!bg-orange-100"
              >
                重新提交
              </Button>
            )}
            {job.status === 'pending' && (
              <Button disabled={isLoadingOther} onClick={() => onCancel(job.id)}>取消</Button>
            )}
            <Button
              disabled={isLoadingOther}
              onClick={() => onEdit(job)}
              title="编辑推送供应商配置与 AI 分析总结"
            >
              编辑
            </Button>
            {onShare && job.status === 'succeeded' && (
              <Button
                disabled={isLoadingOther}
                onClick={() => onShare(job)}
                title="管理该任务的对外分享链接"
              >
                分享
              </Button>
            )}
            <Button
              danger
              disabled={job.status === 'running' || isLoadingOther}
              onClick={() => onDelete(job.id)}
              title={job.status === 'running' ? '处理中的任务无法删除' : undefined}
            >
              删除
            </Button>
          </div>
        )
      },
    },
  ]
}

export function VendorJobsTabContent({ jobs, isLoading, loadingJobId, onRefresh, onLoadResults, onEdit, onShare, onCancel, onDelete, onRetry, stationNameMap, headerAction }: Props) {
  const activeCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  const stationMap = useMemo(() => stationNameMap ?? {}, [stationNameMap])
  const columns = useMemo(
    () => buildColumns(loadingJobId, onLoadResults, onEdit, onShare, onCancel, onDelete, onRetry, stationMap),
    [loadingJobId, onLoadResults, onEdit, onShare, onCancel, onDelete, onRetry, stationMap],
  )

  return (
    <div className="space-y-4">
      <div className="admin-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">任务队列</h3>
          </div>
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <Play className="h-3 w-3" />
                {activeCount} 个任务进行中 · 自动刷新
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            {headerAction}
          </div>
        </div>
      </div>

      <div className="admin-panel overflow-hidden">
        <Table<PublicJob>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={jobs}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{ emptyText: '暂无数据获取任务' }}
          scroll={{ x: 1440 }}
        />
      </div>
    </div>
  )
}
