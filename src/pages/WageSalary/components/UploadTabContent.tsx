// @ts-nocheck
import { Button, DatePicker, Radio } from 'antd'
import { CloudDownload, FileSpreadsheet, Save } from 'lucide-react'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { WageFileUploadBar } from './WageFileUploadBar'
import { UploadPreviewTable } from './UploadPreviewTable'

type IntakeMode = 'upload' | 'api'

export function UploadTabContent({
  handleFileUpload,
  handleZktApiFetch,
  isLoadingZktAttendance,
  wageApiDateRange,
  setWageApiDateRange,
  uploadedData,
  handleSubmitUpload,
  isUploading,
  handleClearUploadedData,
  roleMap,
  roles,
  handleUpdateUploadedRole,
  handleDayOptionChange,
  handleDeleteUploadedRow,
  formatDate,
  formatWorkday,
}) {
  const [mode, setMode] = useState<IntakeMode>('api')

  const range = useMemo(() => {
    if (!wageApiDateRange) return null
    const [start, end] = wageApiDateRange
    const startDay = dayjs(start, 'YYYY-MM-DD', true)
    const endDay = dayjs(end, 'YYYY-MM-DD', true)
    if (!startDay.isValid() || !endDay.isValid()) return null
    return [startDay, endDay]
  }, [wageApiDateRange])

  const handleRangeChange = (values) => {
    if (!values?.[0] || !values[1]) {
      setWageApiDateRange(null)
      return
    }
    setWageApiDateRange([values[0].format('YYYY-MM-DD'), values[1].format('YYYY-MM-DD')])
  }

  const handleFetch = () => {
    if (!wageApiDateRange) return
    void handleZktApiFetch(wageApiDateRange[0], wageApiDateRange[1])
  }

  const intakeBusy = isUploading || isLoadingZktAttendance

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-950">考勤数据</h3>
            <p className="admin-description mt-0.5 text-xs leading-5">
              支持 Excel/CSV 上传或 ZKT API 拉取，预览后计算薪资
            </p>
          </div>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as IntakeMode)}
            optionType="button"
            buttonStyle="solid"
            disabled={intakeBusy}
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
      </div>

      <div className="border-b border-slate-200 px-5 py-3">
        {mode === 'upload' ? (
          <WageFileUploadBar
            variant="attendance"
            title="考勤数据"
            description="支持 .xlsx / .xls / .csv"
            recordCount={uploadedData.length}
            onFileSelect={handleFileUpload}
            onClear={handleClearUploadedData}
            primaryAction={{
              label: '计算薪资',
              loadingLabel: '计算中…',
              onClick: handleSubmitUpload,
              disabled: intakeBusy,
              loading: isUploading,
              icon: <Save className="h-3.5 w-3.5" />,
            }}
          />
        ) : (
          <div
            className={[
              'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 sm:px-4',
              uploadedData.length > 0 ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50/60',
            ].join(' ')}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f7f3] text-[#2f8f87]"
              aria-hidden
            >
              <CloudDownload className="h-4 w-4" />
            </div>

            <div className="min-w-0 flex-1 basis-[12rem]">
              <p className="text-sm font-medium text-slate-900">ZKT 考勤 API</p>
              <p className="text-xs text-slate-500">账号与部门 ID 见系统设置</p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <DatePicker.RangePicker
                value={range}
                onChange={handleRangeChange}
                allowClear
                format="YYYY-MM-DD"
                disabled={intakeBusy}
                className="w-[17.5rem]"
              />
              <Button
                type="default"
                icon={<CloudDownload className="h-4 w-4" aria-hidden />}
                loading={isLoadingZktAttendance}
                disabled={!wageApiDateRange || intakeBusy}
                onClick={handleFetch}
              >
                获取考勤
              </Button>
              {uploadedData.length > 0 && (
                <Button
                  type="primary"
                  icon={<Save className="h-4 w-4" aria-hidden />}
                  loading={isUploading}
                  disabled={intakeBusy}
                  onClick={handleSubmitUpload}
                >
                  计算薪资
                </Button>
              )}
            </div>

            {uploadedData.length > 0 && (
              <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 tabular-nums ring-1 ring-slate-200">
                {uploadedData.length} 条
              </span>
            )}

            {uploadedData.length > 0 && (
              <Button type="link" onClick={handleClearUploadedData} disabled={intakeBusy} className="shrink-0 px-0">
                清空
              </Button>
            )}
          </div>
        )}
      </div>

      {uploadedData.length > 0 && (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-800">
              数据预览
              <span className="ml-2 font-normal text-slate-500">{uploadedData.length} 条</span>
            </h4>
          </div>

          <UploadPreviewTable
            uploadedData={uploadedData}
            roles={roles}
            roleMap={roleMap}
            handleUpdateUploadedRole={handleUpdateUploadedRole}
            handleDayOptionChange={handleDayOptionChange}
            handleDeleteUploadedRow={handleDeleteUploadedRow}
            formatDate={formatDate}
            formatWorkday={formatWorkday}
          />
        </div>
      )}
    </div>
  )
}
