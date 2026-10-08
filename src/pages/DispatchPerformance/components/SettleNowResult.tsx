import { Alert, Button, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SettleNowArtifact } from '../dispatchPerformanceTypes'

export function SettleNowResult({
  artifact,
  onDismiss,
  bare = false,
}: {
  artifact: SettleNowArtifact
  onDismiss: () => void
  bare?: boolean
}) {
  const { t } = useTranslation('dispatchPerformance')

  const hasNothing =
    artifact.settledExitDates.length === 0 && artifact.settledDispatchDates.length === 0

  const skippedItems = artifact.skipped
    .map(
      (item) =>
        `${item.arrivalDate} (${
          item.stage === 'exit'
            ? t('settleResult.skippedStageExit')
            : t('settleResult.skippedStageDispatch')
        })`,
    )
    .join(t('detail.dateListSeparator'))

  return (
    <div className={bare ? 'space-y-4' : 'admin-panel space-y-4 p-4'}>
      {bare ? null : (
        <div className="flex items-start justify-between gap-4">
          <h3 className="admin-title text-base">{t('settleResult.title')}</h3>
          <Button type="link" className="!px-0" onClick={onDismiss}>
            {t('settleResult.close')}
          </Button>
        </div>
      )}

      {hasNothing ? (
        <Alert
          type="info"
          showIcon
          message={artifact.message || t('settleResult.nothingToProcess')}
        />
      ) : null}

      {artifact.settledExitDates.length > 0 ? (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            {t('settleResult.hubExitSettled')}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {t('settleResult.hubExitSettledHint')}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {artifact.settledExitDates.map((item) => (
              <Tag
                key={item.arrivalDate}
                color={item.cellCount > 0 ? 'success' : 'error'}
                className="m-0 font-mono text-xs"
              >
                {t('settleResult.hubExitTag', {
                  date: item.arrivalDate,
                  waybillCount: item.waybillCount,
                  cellCount: item.cellCount,
                })}
              </Tag>
            ))}
          </div>
        </div>
      ) : null}

      {artifact.settledDispatchDates.length > 0 ? (
        <div>
          <div className="mb-2 text-sm font-medium text-slate-700">
            {t('settleResult.dispatchSettled')}
            {artifact.dispatchFinal ? null : (
              <Tag color="warning" className="ml-2 m-0 text-xs">
                {t('settleResult.temporaryValue')}
              </Tag>
            )}
          </div>
          {artifact.dispatchFinal ? null : (
            <p className="mb-2 text-xs text-slate-500">{t('settleResult.dispatchSettledHint')}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-4 font-medium">{t('settleResult.colArrivalDate')}</th>
                  <th className="py-1.5 pr-4 text-right font-medium">{t('settleResult.colTotal')}</th>
                  <th className="py-1.5 pr-4 text-right font-medium">{t('settleResult.colBefore11')}</th>
                  <th className="py-1.5 pr-4 text-right font-medium">{t('settleResult.colSign24h')}</th>
                  <th className="py-1.5 text-right font-medium">{t('settleResult.colProblem')}</th>
                </tr>
              </thead>
              <tbody>
                {artifact.settledDispatchDates.map((row) => (
                  <tr key={row.arrivalDate} className="border-t border-[var(--admin-border)]">
                    <td className="py-1.5 pr-4 font-mono text-xs">
                      {row.arrivalDate}
                      <span className="ml-1 text-slate-400">
                        {t('settleResult.savedRows', { count: row.cellCount })}
                      </span>
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
          message={t('settleResult.skippedTitle', { items: skippedItems })}
          description={t('settleResult.skippedDesc')}
        />
      ) : null}
    </div>
  )
}
