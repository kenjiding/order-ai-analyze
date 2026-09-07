import { Button, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CheckCircle2, Eye, Pause, Play, RefreshCw, User, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { DaCodeAuditEntry, DaCodeItem } from '../types'

type Props = {
  daCodeItems: DaCodeItem[]
  auditMap: Record<string, DaCodeAuditEntry>
  searchLoading: boolean
  activeDaCode: string | null
  onStartAnalysis: (item: DaCodeItem) => void
  onPause: () => void
  onViewDetail: (daCode: string) => void
}

type StatusConfig = {
  color: string
  label: string
  dotClass: string
}

function getStatusConfig(entry: DaCodeAuditEntry | undefined, t: TFunction<'problemPackage'>): StatusConfig {
  if (!entry || entry.analysisStatus === 'idle') {
    return { color: '#9ca3af', label: t('statusPending'), dotClass: 'bg-gray-300' }
  }
  if (entry.loadStatus === 'loading') {
    return { color: '#2f8f87', label: t('statusLoading'), dotClass: 'bg-teal-500 animate-pulse' }
  }
  if (entry.loadStatus === 'error') {
    return { color: '#dc2626', label: t('statusLoadError'), dotClass: 'bg-red-500' }
  }
  if (entry.analysisStatus === 'running') {
    return { color: '#2f8f87', label: t('statusAnalyzing'), dotClass: 'bg-teal-500 animate-pulse' }
  }
  if (entry.analysisStatus === 'paused') {
    return { color: '#d97706', label: t('statusPaused'), dotClass: 'bg-amber-500' }
  }
  if (entry.analysisStatus === 'completed') {
    const hasError = entry.packages.some((p) => p.status === 'error')
    if (hasError) return { color: '#d97706', label: t('statusCompletedWithErrors'), dotClass: 'bg-amber-500' }
    return { color: '#3B6D11', label: t('statusCompleted'), dotClass: 'bg-green-700' }
  }
  return { color: '#9ca3af', label: t('statusPending'), dotClass: 'bg-gray-300' }
}

function ProgressCell({ entry, t }: { entry?: DaCodeAuditEntry; t: TFunction<'problemPackage'> }) {
  const { color, label, dotClass } = getStatusConfig(entry, t)

  const isLoaded = entry?.loadStatus === 'loaded'
  const total = isLoaded ? entry!.packages.length : 0
  const done = isLoaded
    ? entry!.packages.filter((p) => p.status === 'completed' || p.status === 'error').length
    : 0
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
          <span className="text-[12px]" style={{ color }}>
            {label}
          </span>
        </div>
        {isLoaded && total > 0 && (
          <span className="text-[11px] text-slate-400">
            {done} / {total}
          </span>
        )}
      </div>
      {isLoaded && total > 0 && (
        <div className="h-[3px] overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      )}
    </div>
  )
}

function VerdictCell({ entry, t }: { entry?: DaCodeAuditEntry; t: TFunction<'problemPackage'> }) {
  if (!entry || entry.loadStatus !== 'loaded') {
    return <span className="text-[12px] text-slate-300">—</span>
  }

  const completed = entry.packages.filter((p) => p.auditResult !== null)
  if (completed.length === 0) {
    return <span className="text-[12px] text-slate-300">—</span>
  }

  const qualified = completed.filter((p) => p.auditResult?.overallQualified === true).length
  const unqualified = completed.filter((p) => p.auditResult?.overallQualified === false).length

  return (
    <div className="flex flex-col gap-0.5">
      {qualified > 0 && (
        <div className="flex items-center gap-1 text-[12px] text-green-700">
          <CheckCircle2 size={11} strokeWidth={2} />
          <span>{t('qualifiedCount', { count: qualified })}</span>
        </div>
      )}
      {unqualified > 0 && (
        <div className="flex items-center gap-1 text-[12px] text-red-700">
          <XCircle size={11} strokeWidth={2} />
          <span>{t('unqualifiedCount', { count: unqualified })}</span>
        </div>
      )}
    </div>
  )
}

export default function ProblemPackageTable({
  daCodeItems,
  auditMap,
  searchLoading,
  activeDaCode,
  onStartAnalysis,
  onPause,
  onViewDetail,
}: Props) {
  const { t } = useTranslation('problemPackage')

  const columns: ColumnsType<DaCodeItem> = useMemo(
    () => [
      {
        title: t('colDaCode'),
        dataIndex: 'daCode',
        key: 'daCode',
        width: 180,
        render: (val: string, row: DaCodeItem) => {
          const entry = auditMap[row.daCode]
          const isIdle = !entry || entry.analysisStatus === 'idle'
          return (
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: isIdle ? '#f1f5f9' : '#e0f2ef',
                }}
              >
                <User size={13} style={{ color: isIdle ? '#94a3b8' : '#2f8f87' }} />
              </div>
              <span
                className="font-mono text-[13px] font-medium"
                style={{ color: isIdle ? '#94a3b8' : '#1e293b' }}
              >
                {val || '-'}
              </span>
            </div>
          )
        },
      },
      {
        title: t('colOfdDate'),
        dataIndex: 'ofdDate',
        key: 'ofdDate',
        width: 110,
        render: (val: string) => (
          <span className="text-[12px] text-slate-500">{val || '-'}</span>
        ),
      },
      {
        title: t('colProgress'),
        key: 'progress',
        render: (_: unknown, row: DaCodeItem) => (
          <ProgressCell entry={auditMap[row.daCode]} t={t} />
        ),
      },
      {
        title: t('colVerdict'),
        key: 'verdict',
        width: 120,
        align: 'center',
        render: (_: unknown, row: DaCodeItem) => (
          <VerdictCell entry={auditMap[row.daCode]} t={t} />
        ),
      },
      {
        title: t('colActions'),
        key: 'action',
        width: 160,
        align: 'right',
        render: (_: unknown, row: DaCodeItem) => {
          const entry = auditMap[row.daCode]
          const isRunning = activeDaCode === row.daCode && entry?.analysisStatus === 'running'
          const isPaused = entry?.analysisStatus === 'paused'
          const isCompleted = entry?.analysisStatus === 'completed'
          const isOtherRunning = activeDaCode !== null && activeDaCode !== row.daCode

          return (
            <div className="flex items-center justify-end gap-2">
              {isRunning ? (
                <Button
                  icon={<Pause size={12} />}
                  onClick={onPause}
                  style={{ color: '#92400e', borderColor: '#fbbf24', background: '#fffbeb', height: 28, fontSize: 12, padding: '0 10px' }}
                >
                  {t('pause')}
                </Button>
              ) : isPaused ? (
                <Button
                  icon={<Play size={12} />}
                  onClick={() => onStartAnalysis(row)}
                  style={{ backgroundColor: '#2f8f87', borderColor: '#2f8f87', color: '#fff', height: 28, fontSize: 12, padding: '0 10px' }}
                >
                  {t('resume')}
                </Button>
              ) : isCompleted ? (
                <Button
                  icon={<RefreshCw size={12} />}
                  onClick={() => onStartAnalysis(row)}
                  style={{ height: 28, fontSize: 12, padding: '0 10px' }}
                >
                  {t('reanalyze')}
                </Button>
              ) : (
                <Tooltip title={isOtherRunning ? t('otherDaAnalyzing') : undefined}>
                  <Button
                    icon={<Play size={12} />}
                    type="primary"
                    onClick={() => onStartAnalysis(row)}
                    disabled={isOtherRunning}
                    style={{
                      backgroundColor: isOtherRunning ? undefined : '#2f8f87',
                      borderColor: isOtherRunning ? undefined : '#2f8f87',
                      height: 28,
                      fontSize: 12,
                      padding: '0 10px',
                    }}
                  >
                    {t('startAnalysis')}
                  </Button>
                </Tooltip>
              )}

              <Button
                type="link"
                icon={<Eye size={12} />}
                onClick={() => onViewDetail(row.daCode)}
                style={{ color: '#2f8f87', padding: '0 4px', height: 28, fontSize: 12 }}
              >
                {t('detail')}
              </Button>
            </div>
          )
        },
      },
    ],
    [activeDaCode, auditMap, onPause, onStartAnalysis, onViewDetail, t],
  )

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <Table<DaCodeItem>
        columns={columns}
        dataSource={daCodeItems}
        rowKey="daCode"
        loading={searchLoading}
        pagination={daCodeItems.length > 20 ? { pageSize: 20, showTotal: (total) => t('tableTotal', { total }) } : false}
        rowClassName={() => 'transition-colors'}
        locale={{ emptyText: t('emptyTable') }}
        size="middle"
      />
    </div>
  )
}
