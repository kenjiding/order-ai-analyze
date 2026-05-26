// @ts-nocheck
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { WageChartsSection } from './WageChartsSection'

export function WageRecordsPanel({
  wageRecords,
  filteredWageRecords,
  searchQuery,
  setSearchQuery,
  searchRole,
  setSearchRole,
  searchStartDate,
  setSearchStartDate,
  searchEndDate,
  setSearchEndDate,
  roles,
  roleMap,
  handleExport,
  billingVsActualSummary,
  onOpenActualWorkerRates,
  paginatedRecords,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  totalPages,
  rowEditingData,
  setRowEditingData,
  formatDate,
  formatWorkday,
  startRowEditing,
  saveRowEditing,
  cancelRowEditing,
  handleDeleteRecord,
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">工资记录 ({wageRecords.length} 条)</h3>
        <button
          type="button"
          onClick={handleExport}
          disabled={filteredWageRecords.length === 0}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
            filteredWageRecords.length === 0
              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          <Download className="w-4 h-4" />
          导出Excel
        </button>
      </div>

      <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">人员编号/昵称/姓氏</label>
            <input
              type="text"
              placeholder="输入人员编号、昵称或姓氏..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">角色</label>
            <select
              value={searchRole}
              onChange={(e) => setSearchRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">所有角色</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleMap[role]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">开始日期</label>
            <input
              type="date"
              value={searchStartDate}
              onChange={(e) => setSearchStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">结束日期</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={searchEndDate}
                onChange={(e) => setSearchEndDate(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              {(searchStartDate || searchEndDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchStartDate('')
                    setSearchEndDate('')
                  }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                  title="清除日期"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCurrentPage(1)}
            className="flex h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2 text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Search className="w-4 h-4" />
            搜索
          </button>
        </div>
      </div>

      {billingVsActualSummary && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/90 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-amber-950">对账与实际发放对照</h4>
            </div>
            {/* <button
              type="button"
              onClick={onOpenActualWorkerRates}
              className="whitespace-nowrap rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-950 shadow-sm transition-colors hover:bg-amber-100"
            >
              修改实际时薪
            </button> */}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-600">对账 / 导出总额</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                ${billingVsActualSummary.totalBilling.toFixed(2)}
              </div>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-600">小工实际到手合计</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-600">
                ${billingVsActualSummary.totalActualPayout.toFixed(2)}
              </div>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-600">供应商赚取差额（对账 − 实际）</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-red-600">
                ${billingVsActualSummary.supplierMargin.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {filteredWageRecords.length > 0 && (
        <div className="mb-4">
          <WageChartsSection filteredWageRecords={filteredWageRecords} />
        </div>
      )}

      {wageRecords.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p>暂无工资记录</p>
          <p className="text-sm mt-1">请先上传并完成「计算薪资」</p>
        </div>
      ) : filteredWageRecords.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p>没有符合筛选条件的记录</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">人员编号</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓氏</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">昵称</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">工作日</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">总时长</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">类型</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">时薪</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">总工资</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedRecords.map((record) => {
                  const isRowEditing = rowEditingData[record._id] !== undefined
                  const editData = rowEditingData[record._id]

                  return (
                    <tr key={record._id} className={`hover:bg-gray-50 ${isRowEditing ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-3 text-sm text-gray-900">{record.employeeId}</td>
                      <td className="px-3 py-3 text-sm text-gray-900">{record.name || '-'}</td>
                      <td className="px-3 py-3 text-sm text-gray-900">{record.surname || '-'}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">{record.nickname || '-'}</td>
                      <td className="px-3 py-3 text-sm text-gray-600">
                        {isRowEditing ? (
                          <input
                            type="date"
                            value={editData.date || ''}
                            onChange={(e) => {
                              setRowEditingData((prev) => ({
                                ...prev,
                                [record._id]: {
                                  ...prev[record._id],
                                  date: e.target.value,
                                },
                              }))
                            }}
                            className="text-sm border border-gray-300 rounded px-2 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <span>{formatDate(record.date)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-600">
                        {isRowEditing ? (
                          <input
                            type="text"
                            value={editData.workday || ''}
                            onChange={(e) => {
                              setRowEditingData((prev) => ({
                                ...prev,
                                [record._id]: {
                                  ...prev[record._id],
                                  workday: e.target.value,
                                },
                              }))
                            }}
                            className="text-sm border border-gray-300 rounded px-2 py-1 w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="工作日"
                          />
                        ) : (
                          <span>{formatWorkday(record.workday)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-600">
                        {isRowEditing ? (
                          <input
                            type="text"
                            value={editData.totalHours || ''}
                            onChange={(e) => {
                              setRowEditingData((prev) => ({
                                ...prev,
                                [record._id]: {
                                  ...prev[record._id],
                                  totalHours: e.target.value,
                                },
                              }))
                            }}
                            className="text-sm border border-gray-300 rounded px-2 py-1 w-20 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="总时长"
                          />
                        ) : (
                          <span>
                            {record.totalHours} ({record.totalHoursDecimal.toFixed(2)}h)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        {isRowEditing ? (
                          <select
                            value={editData.role || 'worker'}
                            onChange={(e) => {
                              setRowEditingData((prev) => ({
                                ...prev,
                                [record._id]: {
                                  ...prev[record._id],
                                  role: e.target.value,
                                },
                              }))
                            }}
                            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {roleMap[role]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              record.role === 'worker'
                                ? 'bg-blue-100 text-blue-800'
                                : record.role === 'forklift'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {roleMap[record.role]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm">
                        {isRowEditing ? (
                          <select
                            value={
                              editData.isPublicHoliday
                                ? 'publicHoliday'
                                : editData.isSorting
                                  ? 'sorting'
                                  : 'regular'
                            }
                            onChange={(e) => {
                              const type = e.target.value
                              setRowEditingData((prev) => ({
                                ...prev,
                                [record._id]: {
                                  ...prev[record._id],
                                  isPublicHoliday: type === 'publicHoliday',
                                  isSorting: type === 'sorting',
                                },
                              }))
                            }}
                            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="regular">不分拣</option>
                            <option value="sorting">分拣</option>
                            <option value="publicHoliday">公共假期</option>
                          </select>
                        ) : record.isPublicHoliday ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800">
                            公共假期
                          </span>
                        ) : record.isSorting ? (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-800">
                            分拣
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            不分拣
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm text-right text-gray-900 font-medium">
                        ${record.hourlyRate.toFixed(2)}
                      </td>
                      <td className="px-3 py-3 text-sm text-right text-green-600 font-bold">
                        ${record.totalWage.toFixed(2)}
                      </td>
                      <td className="px-3 py-3 text-sm text-center">
                        <div className="flex items-center justify-center gap-2">
                          {isRowEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveRowEditing(record._id)}
                                className="text-green-600 hover:text-green-800"
                                title="保存"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelRowEditing(record._id)}
                                className="text-gray-600 hover:text-gray-800"
                                title="取消"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startRowEditing(record)}
                                className="text-blue-600 hover:text-blue-800"
                                title="编辑"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecord(record._id)}
                                className="text-red-600 hover:text-red-800"
                                title="删除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan="6" className="px-3 py-3 text-sm font-bold text-right text-gray-900">
                    当前页总计:
                  </td>
                  <td className="px-3 py-3 text-sm text-right font-bold text-gray-900">
                    {paginatedRecords.reduce((sum, r) => sum + r.totalHoursDecimal, 0).toFixed(2)}h
                  </td>
                  <td colSpan="3" className="px-3 py-3" aria-hidden />
                  <td className="px-3 py-3 text-sm text-right font-bold text-green-600">
                    ${paginatedRecords.reduce((sum, r) => sum + r.totalWage, 0).toFixed(2)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">每页显示</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="text-sm text-gray-600">条</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="text-sm text-gray-600">
                  第 {currentPage} / {totalPages} 页
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
