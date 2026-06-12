// @ts-nocheck
import { Save } from 'lucide-react'
import { WageFileUploadBar } from './WageFileUploadBar'
import { UploadPreviewTable } from './UploadPreviewTable'

export function UploadTabContent({
  handleFileUpload,
  uploadedData,
  uploadedSourceFileName,
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
  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title py-3">
        <h3 className="text-base font-semibold text-slate-950">上传配置</h3>
        <p className="admin-description mt-0.5 text-xs leading-5">
          导入考勤 Excel/CSV，在下方预览中调整角色与日配置后计算薪资
        </p>
      </div>

      <div className="border-b border-slate-200 px-5 py-3">
        <WageFileUploadBar
          variant="attendance"
          title="考勤数据"
          description="支持 .xlsx / .xls / .csv"
          sourceFileName={uploadedSourceFileName}
          recordCount={uploadedData.length}
          onFileSelect={handleFileUpload}
          onClear={handleClearUploadedData}
          primaryAction={{
            label: '计算薪资',
            loadingLabel: '计算中…',
            onClick: handleSubmitUpload,
            disabled: isUploading,
            loading: isUploading,
            icon: <Save className="h-3.5 w-3.5" />,
          }}
        />
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
