import { Button, DatePicker, Radio, Tooltip } from 'antd'
import { CloudDownload, FileSpreadsheet, Upload, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Dayjs } from 'dayjs'
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
    clearAttendance,
    clearAll,
  } = vm

  const [mode, setMode] = useState<IntakeMode>('api')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const scanFileInputRef = useRef<HTMLInputElement>(null)
  const attendanceFileInputRef = useRef<HTMLInputElement>(null)

  const handleFetch = () => {
    if (!range) return
    void handleScanApiFetch(range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-950">载入扫描记录</h2>
          <p className="mt-0.5 text-xs text-slate-500">文件与 API 可并存，多次载入合并并按运单号去重</p>
        </div>

        <Radio.Group
          className="admin-toggle-track"
          value={mode}
          onChange={(e) => setMode(e.target.value as IntakeMode)}
          optionType="button"
          buttonStyle="outline"
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

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {mode === 'upload' ? (
          <>
            <input
              ref={scanFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              disabled={loading}
              onChange={(event) => {
                void handleScanFileChange(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              type="default"
              icon={<Upload className="h-4 w-4" aria-hidden />}
              disabled={loading}
              onClick={() => scanFileInputRef.current?.click()}
            >
              上传到件扫描文件
              <span className="hidden font-normal text-slate-500 sm:inline">（.xlsx / .xls · 可多选）</span>
            </Button>
          </>
        ) : (
          <>
            <DatePicker.RangePicker
              value={range}
              onChange={(values) => setRange(values as [Dayjs, Dayjs] | null)}
              allowClear
              format="YYYY-MM-DD"
              disabled={loading}
              className="min-w-[220px]"
            />
            <Button
              type="primary"
              icon={<CloudDownload className="h-4 w-4" aria-hidden />}
              loading={loading}
              disabled={!range}
              onClick={handleFetch}
            >
              拉取到件
            </Button>
          </>
        )}

        <span className="hidden h-4 w-px bg-[var(--admin-line)] sm:block" aria-hidden />

        <input
          ref={attendanceFileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          disabled={loading}
          onChange={(event) => {
            void handleAttendanceFileChange(event.target.files)
            event.target.value = ''
          }}
        />
        <Button
          type="default"
          icon={<Users className="h-4 w-4" aria-hidden />}
          disabled={loading}
          onClick={() => attendanceFileInputRef.current?.click()}
        >
          上传考勤（可选）
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Tooltip title="仅清除考勤数据，保留到件扫描">
            <Button type="default" danger onClick={clearAttendance}>
              清空考勤
            </Button>
          </Tooltip>
          <Button type="default" onClick={clearAll}>
            清空全部
          </Button>
        </div>
      </div>
    </div>
  )
}
