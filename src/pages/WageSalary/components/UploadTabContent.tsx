// @ts-nocheck
import { Save, Upload, X, Trash2 } from 'lucide-react'

export function UploadTabContent({
  isSorting,
  setIsSorting,
  isPublicHoliday,
  setIsPublicHoliday,
  handleFileUpload,
  uploadedData,
  uploadedSourceFileName,
  handleSubmitUpload,
  isUploading,
  handleClearUploadedData,
  rateSettings,
  roleMap,
  roles,
  handleUpdateUploadedRole,
  handleDayOptionChange,
  handleDeleteUploadedRow,
  formatDate,
  formatWorkday,
}) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">上传配置</h3>
        </div>

        <div className="flex flex-col md:flex-row md:items-stretch gap-4 mb-4">

        <div className="flex gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50 md:flex-1 md:min-w-0 items-start">
            <Upload className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="min-w-0 space-y-1">
                <span className="text-sm font-medium text-emerald-950 block">文件导入与计算</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="cursor-pointer">
                  <div className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 shadow-sm transition-colors hover:bg-emerald-100/80">
                    选择文件
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
                {uploadedData.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleSubmitUpload}
                      disabled={isUploading}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="h-4 w-4 shrink-0" />
                      {isUploading ? '薪资计算中...' : '计算薪资'}
                    </button>
                    <button
                      type="button"
                      onClick={handleClearUploadedData}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 shadow-sm transition-colors hover:bg-emerald-100/80"
                    >
                      <X className="h-4 w-4 shrink-0 text-emerald-700" />
                      清空
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 md:flex-1 min-w-0">
            <input
              type="checkbox"
              id="isSorting"
              checked={isSorting}
              onChange={(e) => setIsSorting(e.target.checked)}
              className="h-5 w-5 shrink-0 rounded border-blue-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
            />
            <label htmlFor="isSorting" className="cursor-pointer flex-1 min-w-0">
              <span className="text-sm font-medium text-blue-950">是否分拣（影响周末时薪）</span>
              <p className="text-xs text-blue-800/90 mt-0.5">仅影响周末，非节假日时生效</p>
            </label>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border border-rose-200 bg-rose-50 md:flex-1 min-w-0">
            <input
              type="checkbox"
              id="isPublicHoliday"
              checked={isPublicHoliday}
              onChange={(e) => setIsPublicHoliday(e.target.checked)}
              className="h-5 w-5 shrink-0 rounded border-rose-300 text-rose-600 accent-rose-600 focus:ring-2 focus:ring-rose-500 focus:ring-offset-0 cursor-pointer"
            />
            <label htmlFor="isPublicHoliday" className="cursor-pointer flex-1 min-w-0">
              <span className="text-sm font-medium text-rose-950">是否公共节假日（三倍工资）</span>
              <p className="text-xs text-rose-800/90 mt-0.5">优先级最高，全天按节假日时薪计算</p>
            </label>
          </div>
        </div>
      </div>

      {uploadedData.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">数据预览 ({uploadedData.length} 条记录)</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">人员编号</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓氏</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">昵称</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">部门</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">工作日</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">总时长</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">日配置</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {uploadedData.map((record, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-3 py-3 text-sm text-gray-900">{record.employeeId}</td>
                    <td className="px-3 py-3 text-sm text-gray-900">{record.name || '-'}</td>
                    <td className="px-3 py-3 text-sm text-gray-900">{record.surname || '-'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{record.nickname || '-'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{record.department}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{formatDate(record.date)}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{formatWorkday(record.workday)}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{record.totalHours}</td>
                    <td className="px-3 py-3 text-sm">
                      <select
                        value={record.role}
                        onChange={(e) => handleUpdateUploadedRole(index, e.target.value)}
                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {roleMap[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700">
                      <div className="flex flex-col items-start gap-2">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="radio"
                            name={`day-option-${index}`}
                            value="publicHoliday"
                            checked={record.weekendOption === 'publicHoliday'}
                            onChange={() => handleDayOptionChange(index, 'publicHoliday')}
                            className="text-red-500 focus:ring-red-500"
                          />
                          <span>公共节假日</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="radio"
                            name={`day-option-${index}`}
                            value="sorting"
                            checked={record.weekendOption === 'sorting'}
                            onChange={() => handleDayOptionChange(index, 'sorting')}
                            className="text-blue-500 focus:ring-blue-500"
                          />
                          <span>分拣</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="radio"
                            name={`day-option-${index}`}
                            value="regularWeekend"
                            checked={record.weekendOption === 'regularWeekend'}
                            onChange={() => handleDayOptionChange(index, 'regularWeekend')}
                            className="text-gray-500 focus:ring-gray-500"
                          />
                          <span>不分拣</span>
                        </label>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm">
                      <button
                        type="button"
                        onClick={() => handleDeleteUploadedRow(index)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
