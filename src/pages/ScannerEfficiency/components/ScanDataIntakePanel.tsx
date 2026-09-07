import { Button, DatePicker, Radio, Tooltip } from 'antd'
import { CloudDownload, FileSpreadsheet, Save, Upload, Users } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Dayjs } from 'dayjs'
import { dayjs } from '../dayjsSetup'
import { formatInteger } from '../formatAndParse'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'

type IntakeMode = 'upload' | 'api'

type Props = {
  vm: ScannerEfficiencyViewModel
}

export function ScanDataIntakePanel({ vm }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const {
    loading,
    handleScanFileChange,
    handleScanApiFetch,
    handleAttendanceFileChange,
    handleSaveDailyRecords,
    canSaveDailyRecords,
    savingDailyRecords,
    clearAll,
    scanSourceInfo,
    attendanceSourceInfo,
    snapshotRestore,
    apiDateRange,
    setApiDateRange,
  } = vm

  const readOnly = Boolean(snapshotRestore)
  const [mode, setMode] = useState<IntakeMode>('api')
  const scanFileInputRef = useRef<HTMLInputElement>(null)
  const attendanceFileInputRef = useRef<HTMLInputElement>(null)

  const range = useMemo<[Dayjs, Dayjs] | null>(() => {
    if (!apiDateRange) return null
    const [start, end] = apiDateRange
    const startDay = dayjs(start, 'YYYY-MM-DD', true)
    const endDay = dayjs(end, 'YYYY-MM-DD', true)
    if (!startDay.isValid() || !endDay.isValid()) return null
    return [startDay, endDay]
  }, [apiDateRange])

  const handleRangeChange = (values: [Dayjs, Dayjs] | null) => {
    if (!values?.[0] || !values[1]) {
      setApiDateRange(null)
      return
    }
    setApiDateRange([values[0].format('YYYY-MM-DD'), values[1].format('YYYY-MM-DD')])
  }

  const handleFetch = () => {
    if (!apiDateRange || readOnly) return
    void handleScanApiFetch(apiDateRange[0], apiDateRange[1])
  }

  const statusLine = useMemo(() => {
    if (readOnly) return t('intake.statusReadonly')
    const parts: string[] = []
    if (scanSourceInfo.rowCount > 0) {
      parts.push(t('intake.statusInbound', { count: formatInteger(scanSourceInfo.rowCount) }))
    }
    if (attendanceSourceInfo.rowCount > 0) {
      parts.push(t('intake.statusAttendance', { count: formatInteger(attendanceSourceInfo.rowCount) }))
    }
    if (!parts.length) return t('intake.statusEmpty')
    if (canSaveDailyRecords) return t('intake.statusSavable', { parts: parts.join(t('common.listSeparator')) })
    return parts.join(t('common.listSeparator'))
  }, [attendanceSourceInfo.rowCount, canSaveDailyRecords, readOnly, scanSourceInfo.rowCount, t])

  const actionsDisabled = readOnly || loading

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--admin-text)]">{t('intake.title')}</h2>
          <p className="mt-0.5 text-xs text-[var(--admin-muted)]">{t('intake.subtitle')}</p>
        </div>

        <Radio.Group
          className="shrink-0"
          value={mode}
          onChange={(e) => setMode(e.target.value as IntakeMode)}
          optionType="button"
          buttonStyle="solid"
          disabled={actionsDisabled}
        >
          <Radio.Button value="upload">
            <span className="inline-flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {t('intake.modeFile')}
            </span>
          </Radio.Button>
          <Radio.Button value="api">
            <span className="inline-flex items-center gap-1.5">
              <CloudDownload className="h-4 w-4" aria-hidden />
              {t('intake.modeApi')}
            </span>
          </Radio.Button>
        </Radio.Group>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {mode === 'upload' ? (
          <>
            <input
              ref={scanFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              disabled={actionsDisabled}
              onChange={(event) => {
                void handleScanFileChange(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              type="default"
              icon={<Upload className="h-4 w-4" aria-hidden />}
              disabled={actionsDisabled}
              onClick={() => scanFileInputRef.current?.click()}
            >
              {t('intake.uploadInbound')}
            </Button>
          </>
        ) : (
          <>
            <DatePicker.RangePicker
              value={range}
              onChange={(values) => handleRangeChange(values as [Dayjs, Dayjs] | null)}
              allowClear
              format="YYYY-MM-DD"
              disabled={actionsDisabled}
            />
            <Button
              type="primary"
              icon={<CloudDownload className="h-4 w-4" aria-hidden />}
              loading={loading}
              disabled={!apiDateRange || readOnly}
              onClick={handleFetch}
            >
              {t('intake.fetchData')}
            </Button>
          </>
        )}

        {mode === 'upload' ? (
          <>
            <input
              ref={attendanceFileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              className="hidden"
              disabled={actionsDisabled}
              onChange={(event) => {
                void handleAttendanceFileChange(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              type="default"
              icon={<Users className="h-4 w-4" aria-hidden />}
              disabled={actionsDisabled}
              onClick={() => attendanceFileInputRef.current?.click()}
            >
              {t('intake.uploadAttendance')}
            </Button>
          </>
        ) : null}

        <div className="flex items-center gap-1.5">
          <Tooltip
            title={
              canSaveDailyRecords ? t('intake.saveTooltipReady') : t('intake.saveTooltipNeedBoth')
            }
          >
            <Button
              type="primary"
              icon={<Save className="h-4 w-4" aria-hidden />}
              loading={savingDailyRecords}
              disabled={!canSaveDailyRecords || actionsDisabled}
              onClick={() => void handleSaveDailyRecords()}
            >
              {t('intake.save')}
            </Button>
          </Tooltip>
          <Button type="default" danger disabled={actionsDisabled} onClick={clearAll}>
            {t('intake.clearAll')}
          </Button>
        </div>
      </div>

      <p className="min-w-0 border-t border-[var(--admin-line)] pt-3 text-xs leading-relaxed text-[var(--admin-muted)] tabular-nums">
        {statusLine}
      </p>
    </div>
  )
}
