import Tooltip from '@mui/material/Tooltip'
import { Button, InputNumber } from 'antd'
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import { ScanDataIntakePanel } from './ScanDataIntakePanel'

type Props = {
  vm: ScannerEfficiencyViewModel
}

export default function ScannerEfficiencyTopSection({ vm }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const {
    settings,
    handleSettingChange,
    openDayRuleTooltipText,
    snapshotRestore,
    dismissSnapshotRestore,
  } = vm

  return (
    <section className="admin-panel se-hero overflow-hidden">
      {snapshotRestore ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(47,143,135,0.22)] bg-[var(--admin-accent-soft)] px-5 py-3 sm:px-6">
          <div className="min-w-0 text-sm text-[#1f6f68]">
            <span className="font-semibold">{t('page.snapshotMode')}</span>
            <span className="mx-2 text-[#2f8f87]/60" aria-hidden>
              |
            </span>
            {t('page.snapshotViewing', { date: snapshotRestore.restoredDate })}
            {snapshotRestore.restoredDates.length > 1
              ? t('page.snapshotMerged', { count: snapshotRestore.restoredDates.length })
              : ''}
            {t('page.snapshotReadonlyHint')}
          </div>
          <Button type="default" onClick={dismissSnapshotRestore}>
            {t('page.exitView')}
          </Button>
        </div>
      ) : null}
      <header className="se-hero-head border-b border-[var(--admin-line)] px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <h1 className="se-page-title">{t('page.title')}</h1>
            <p className="se-page-lead">{t('page.lead')}</p>
          </div>
          <div className="se-status-badge shrink-0">{t('page.badge')}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:divide-x lg:divide-[var(--admin-line)]">
        <div className="se-settings-block border-b border-[var(--admin-line)] px-5 py-5 sm:px-6 lg:border-b-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">{t('page.openDaySettings')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--admin-muted)]">
              {t('page.openDaySettingsHint')}
            </p>
          </div>

          <div className="mt-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Tooltip title={openDayRuleTooltipText} arrow enterDelay={200}>
                <label
                  htmlFor="openDayThresholdInput"
                  className="inline-flex cursor-help items-center gap-1 text-xs font-medium text-[var(--admin-text)]"
                >
                  <Gauge className="h-3.5 w-3.5 shrink-0 text-[var(--admin-accent)]" aria-hidden />
                  {t('page.openDayThreshold')}
                </label>
              </Tooltip>
              <InputNumber
                id="openDayThresholdInput"
                min={1}
                step={1}
                value={settings.openDayThreshold}
                disabled={Boolean(snapshotRestore)}
                onChange={(value) => handleSettingChange('openDayThreshold', String(value ?? ''))}
                className="w-full [&_.ant-input-number-input]:text-center [&_.ant-input-number-input]:font-semibold [&_.ant-input-number-input]:tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="se-intake-shell min-w-0 px-5 py-5 sm:px-6">
          <ScanDataIntakePanel vm={vm} />
        </div>
      </div>
    </section>
  )
}
