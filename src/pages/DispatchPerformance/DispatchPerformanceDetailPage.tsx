import { Alert, Button, DatePicker, Popconfirm, Select, Tag, Tooltip } from 'antd'
import { ArrowLeft, RefreshCw, Zap } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Dayjs } from 'dayjs'
import { PerformanceBreakdownTable } from './components/PerformanceBreakdownTable'
import { SettleNowResult } from './components/SettleNowResult'
import { useDispatchPerformanceDetailPage } from './useDispatchPerformanceDetailPage'
import type { DispatchMetrics, DispatchSettledBatch } from './dispatchPerformanceTypes'

const { RangePicker } = DatePicker

function SummaryTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warn'
}) {
  return (
    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-600' : 'text-slate-950'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : `${rate.toFixed(2)}%`
}

function SummaryTiles({ overall }: { overall: DispatchMetrics }) {
  const { quadrant } = overall
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryTile
        label="11点前出仓率"
        value={formatRate(overall.before11Rate)}
        hint={`${overall.before11Met} / ${overall.total} 单`}
      />
      <SummaryTile
        label="24小时派签率"
        value={overall.dispatchSettled ? formatRate(overall.signRate) : '结算中'}
        hint={
          overall.dispatchSettled
            ? `${overall.signMet} / ${overall.total} 单`
            : '需等 24 小时窗口到期，次日定时任务补上'
        }
      />
      <SummaryTile
        label="准时出仓但派签超时"
        value={overall.dispatchSettled ? String(quadrant.exitMetSignUnmet) : '—'}
        hint="货已按时交给司机，仍未派完 —— 司机侧"
        tone={overall.dispatchSettled && quadrant.exitMetSignUnmet > 0 ? 'warn' : 'default'}
      />
      <SummaryTile
        label="出仓超时且派签超时"
        value={overall.dispatchSettled ? String(quadrant.exitUnmetSignUnmet) : '—'}
        hint="晚出仓拖垮派签 —— 仓库侧连锁"
        tone={overall.dispatchSettled && quadrant.exitUnmetSignUnmet > 0 ? 'warn' : 'default'}
      />
    </div>
  )
}

/** 结算进度条：每个到件日两趟各自跑到哪一步，任务没跑时一眼可见 */
function SettleProgress({ batches }: { batches: DispatchSettledBatch[] }) {
  if (batches.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">最近结算：</span>
      {batches.map((batch) => (
        <Tooltip
          key={batch.arrivalDate}
          title={
            <div className="text-xs">
              <div>到件日 {batch.arrivalDate}</div>
              <div>运单 {batch.waybillCount} 条</div>
              <div>出仓：{batch.exitSettled ? '已结算' : '未结算'}</div>
              <div>派签：{batch.dispatchSettled ? '已结算' : '结算中'}</div>
            </div>
          }
        >
          <Tag
            color={batch.dispatchSettled ? 'success' : batch.exitSettled ? 'processing' : 'default'}
            className="m-0 font-mono text-xs"
          >
            {batch.arrivalDate.slice(5)}
          </Tag>
        </Tooltip>
      ))}
    </div>
  )
}

export default function DispatchPerformanceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const v = useDispatchPerformanceDetailPage(id)

  const config = v.result?.config

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div className="min-w-0">
            <Button
              type="link"
              className="!px-0"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate('/dispatch-performance')}
            >
              返回统计站点列表
            </Button>
            <h2 className="admin-title mt-1 flex flex-wrap items-center gap-2">
              {config?.stationName || config?.stationCode || '出仓派签达成分析'}
              {config ? (
                <span className="font-mono text-sm font-normal text-slate-400">
                  {config.stationCode}
                </span>
              ) : null}
              {config && !config.isEnabled ? <Tag color="default">已停用</Tag> : null}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              以「到件日」为批次的最终值，按供应商 / 路由码 / 司机三层下钻
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Popconfirm
              title="立刻统计"
              description={
                <div className="max-w-[320px] text-xs leading-relaxed">
                  出仓率会立刻结算并写入历史；派签率只当场算给你看、
                  <b>不写入</b>——24 小时窗口可能还没真正关闭，此刻定格会偏严。
                  派签的权威值仍由该站点触发统计时间的定时任务写。
                </div>
              }
              okText="开始统计"
              cancelText="取消"
              onConfirm={() => void v.settleNow()}
            >
              <Button
                type="primary"
                icon={<Zap className="h-4 w-4" />}
                loading={v.settling}
                disabled={config ? !config.isEnabled : true}
              >
                立刻统计
              </Button>
            </Popconfirm>
            <Tooltip title="重新查询">
              <Button
                icon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void v.reload()}
                loading={v.loading}
              >
                刷新
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-6 py-4">
          <RangePicker
            value={v.range}
            onChange={(dates) => {
              if (dates?.[0] && dates?.[1]) v.setRange([dates[0], dates[1]] as [Dayjs, Dayjs])
            }}
            allowClear={false}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="全部供应商"
            value={v.supplierKeys}
            onChange={v.setSupplierKeys}
            options={(v.result?.supplierOptions ?? []).map((s) => ({
              label: s.supplierName,
              value: s.supplierKey,
            }))}
            className="min-w-[260px]"
            maxTagCount="responsive"
          />
          {v.result ? <SettleProgress batches={v.result.recentBatches} /> : null}
        </div>
      </div>

      {v.error ? <Alert type="error" showIcon message={v.error} /> : null}

      {v.settleResult ? (
        <SettleNowResult artifact={v.settleResult} onDismiss={v.dismissSettleResult} />
      ) : null}

      {v.pendingDispatch ? (
        <Alert
          type="info"
          showIcon
          message="派签率结算中"
          description="两个指标结算时机差一天：出仓率在到件次日出、派签率要等 24 小时窗口到期（再晚一天）。区间里最新那天目前只有出仓率。"
        />
      ) : null}

      {v.missingDates.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`以下到件日没有数据：${v.missingDates.join('、')}`}
          description="要么当天不分拣、本就没有到件，要么结算任务没跑到。数据由每日定时任务产出，页面不触发重算。"
        />
      ) : null}

      {v.result ? (
        <>
          <SummaryTiles overall={v.result.overall} />
          {v.result.whitelistTotal > 0 ? (
            <Alert
              type="info"
              showIcon
              message={`本区间有 ${v.result.whitelistTotal} 单落在白名单路由上，未计入上面的两个率`}
              description="白名单路由不参与考核，但数据照常统计：展开供应商即可看到这些路由的单量与达成情况，路由码行上带「白名单」标记。"
            />
          ) : null}
          <div className="admin-panel p-4">
            <PerformanceBreakdownTable suppliers={v.result.suppliers} loading={v.loading} />
          </div>
        </>
      ) : null}
    </div>
  )
}
