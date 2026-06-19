import { Button, DatePicker, Radio, Tooltip } from 'antd'
import { CloudDownload, FileSpreadsheet, Save, Upload, Users } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
import { formatInteger } from '../formatAndParse'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'

type IntakeMode = 'upload' | 'api'

type Props = {
  vm: ScannerEfficiencyViewModel
}

export function ScanDataIntakePanel({ vm }: Props) {
  const {
    loading,
    handleScanFileChange,
    handleScanApiFetch,
    handleAttendanceFileChange,
    handleSaveDailyRecords,
    canSaveDailyRecords,
    savingDailyRecords,
    clearAttendance,
    clearAll,
    scanSourceInfo,
    attendanceSourceInfo,
    snapshotRestore,
  } = vm

  const readOnly = Boolean(snapshotRestore)
  const [mode, setMode] = useState<IntakeMode>('api')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const scanFileInputRef = useRef<HTMLInputElement>(null)
  const attendanceFileInputRef = useRef<HTMLInputElement>(null)

  const handleRangeChange = (values: [Dayjs, Dayjs] | null) => {
    setRange(values)
    vm.setApiDateRange(
      values ? [values[0].format('YYYY-MM-DD'), values[1].format('YYYY-MM-DD')] : null,
    )
  }

  const handleFetch = () => {
    if (!range || readOnly) return
    void handleScanApiFetch(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'))
  }

  const statusLine = useMemo(() => {
    if (readOnly) return '记录查看模式，重新载入或退出查看后可操作'
    const parts: string[] = []
    if (scanSourceInfo.rowCount > 0) {
      parts.push(`到件 ${formatInteger(scanSourceInfo.rowCount)} 条`)
    }
    if (attendanceSourceInfo.rowCount > 0) {
      parts.push(`考勤 ${formatInteger(attendanceSourceInfo.rowCount)} 条`)
    }
    if (!parts.length) return '尚未载入数据'
    if (canSaveDailyRecords) return `${parts.join('，')}，可保存`
    return parts.join('，')
  }, [attendanceSourceInfo.rowCount, canSaveDailyRecords, readOnly, scanSourceInfo.rowCount])

  const actionsDisabled = readOnly || loading

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--admin-text)]">载入扫描记录</h2>
          <p className="mt-0.5 text-xs text-[var(--admin-muted)]">支持 Excel 上传或按日期范围 API 拉取</p>
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
              文件
            </span>
          </Radio.Button>
          <Radio.Button value="api">
            <span className="inline-flex items-center gap-1.5">
              <CloudDownload className="h-4 w-4" aria-hidden />
              API
            </span>
          </Radio.Button>
        </Radio.Group>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="se-intake-lane min-w-0">
          <div className="se-intake-lane-label">
            到件 <span>必传</span>
          </div>
          <div className="mt-2.5 flex min-w-0 flex-col gap-2">
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
                  block
                  icon={<Upload className="h-4 w-4" aria-hidden />}
                  disabled={actionsDisabled}
                  onClick={() => scanFileInputRef.current?.click()}
                >
                  上传到件扫描
                </Button>
                <p className="text-[11px] text-[var(--admin-muted)]">.xlsx / .xls，可多选</p>
              </>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <DatePicker.RangePicker
                  value={range}
                  onChange={(values) => handleRangeChange(values as [Dayjs, Dayjs] | null)}
                  allowClear
                  format="YYYY-MM-DD"
                  disabled={actionsDisabled}
                  className="min-w-0 flex-1"
                />
                <Button
                  type="primary"
                  icon={<CloudDownload className="h-4 w-4" aria-hidden />}
                  loading={loading}
                  disabled={!range || readOnly}
                  onClick={handleFetch}
                >
                  获取数据
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="se-intake-lane min-w-0">
          <div className="se-intake-lane-label">
            考勤 <span>可选</span>
          </div>
          <div className="mt-2.5 flex min-w-0 flex-col gap-2">
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
              block
              icon={<Users className="h-4 w-4" aria-hidden />}
              disabled={actionsDisabled}
              onClick={() => attendanceFileInputRef.current?.click()}
            >
              上传考勤
            </Button>
            <p className="text-[11px] text-[var(--admin-muted)]">.csv / .xlsx / .xls</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--admin-line)] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-xs leading-relaxed text-[var(--admin-muted)] tabular-nums">{statusLine}</p>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <Tooltip
            title={
              canSaveDailyRecords
                ? '按日写入效率考勤记录，同日覆盖'
                : '需同时载入到件与考勤'
            }
          >
            <Button
              type="primary"
              icon={<Save className="h-4 w-4" aria-hidden />}
              loading={savingDailyRecords}
              disabled={!canSaveDailyRecords || actionsDisabled}
              onClick={() => void handleSaveDailyRecords()}
            >
              保存
            </Button>
          </Tooltip>
          <Tooltip title="仅清除考勤数据，保留到件扫描">
            <Button type="default" danger disabled={actionsDisabled} onClick={clearAttendance}>
              清空考勤
            </Button>
          </Tooltip>
          <Button type="default" disabled={actionsDisabled} onClick={clearAll}>
            清空全部
          </Button>
        </div>
      </div>
    </div>
  )
}
