import { Alert, Button, Tag } from 'antd'
import type { SettleNowArtifact } from '../dispatchPerformanceTypes'

/**
 * 「立刻统计」的结果面板。出仓与派签都已写进历史，但两者的确定性不同，必须视觉上分开：
 * 出仓阈值过了就定死；派签是临时值——24h 窗口对「晚于 11 点出仓」的单可能还没真正关闭，
 * 台账上没给派签盖章，到了该站点的触发统计时间会重跑并覆盖。
 */
export function SettleNowResult({
  artifact,
  onDismiss,
  /** 放进 Modal 时关掉自带的标题与关闭按钮，避免与 Modal 自身的重复 */
  bare = false,
}: {
  artifact: SettleNowArtifact
  onDismiss: () => void
  bare?: boolean
}) {
  const hasNothing =
    artifact.settledExitDates.length === 0 && artifact.settledDispatchDates.length === 0

  return (
    <div className={bare ? 'space-y-4' : 'admin-panel space-y-4 p-4'}>
      {bare ? null : (
        <div className="flex items-start justify-between gap-4">
          <h3 className="admin-title text-base">立刻统计结果</h3>
          <Button type="link" className="!px-0" onClick={onDismiss}>
            关闭
          </Button>
        </div>
      )}

      {hasNothing ? (
        <Alert type="info" showIcon message={artifact.message || '本次没有可处理的批次'} />
      ) : null}

      {artifact.settledExitDates.length > 0 ? (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            出仓已结算并写入历史
            <span className="ml-2 text-xs font-normal text-slate-400">
              阈值是出仓日 11:00，过了就定死，提前跑与到点跑结论一致
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {artifact.settledExitDates.map((item) => (
              <Tag
                key={item.arrivalDate}
                color={item.cellCount > 0 ? 'success' : 'error'}
                className="m-0 font-mono text-xs"
              >
                {item.arrivalDate}（{item.waybillCount} 单 → 落库 {item.cellCount} 行）
              </Tag>
            ))}
          </div>
        </div>
      ) : null}

      {artifact.settledDispatchDates.length > 0 ? (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            派签已结算并写入历史
            <Tag color="warning" className="ml-2 m-0 text-xs">
              临时值
            </Tag>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            24 小时窗口对「晚于 11 点出仓」的单可能还没真正关闭，此刻的未达标数会偏多。
            到了触发统计时间，定时任务会重跑并覆盖成权威值。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-4 font-medium">到件日</th>
                  <th className="py-1.5 pr-4 text-right font-medium">总单量</th>
                  <th className="py-1.5 pr-4 text-right font-medium">11点前出仓</th>
                  <th className="py-1.5 pr-4 text-right font-medium">24h 派签</th>
                  <th className="py-1.5 text-right font-medium">问题件</th>
                </tr>
              </thead>
              <tbody>
                {artifact.settledDispatchDates.map((row) => (
                  <tr key={row.arrivalDate} className="border-t border-[var(--admin-border)]">
                    <td className="py-1.5 pr-4 font-mono text-xs">
                      {row.arrivalDate}
                      <span className="ml-1 text-slate-400">（落库 {row.cellCount} 行）</span>
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{row.total}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {row.total > 0
                        ? `${((row.before11Met / row.total) * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {row.total > 0 ? `${((row.signMet / row.total) * 100).toFixed(2)}%` : '—'}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.problemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {artifact.skipped.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`已过期不回补：${artifact.skipped
            .map((item) => `${item.arrivalDate}（${item.stage === 'exit' ? '出仓' : '派签'}）`)
            .join('、')}`}
          description="新站点首次启用，或该批到期时任务没跑成功。回补会读到退仓重派后的状态，故放弃。"
        />
      ) : null}
    </div>
  )
}
