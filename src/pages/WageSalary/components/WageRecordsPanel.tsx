// @ts-nocheck
import { AlertCircle, Download, Search, X } from 'lucide-react'

import { WageChartsSection } from './WageChartsSection'
import { WageRecordsTable } from './WageRecordsTable'

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
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
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
            <label className="block text-xs font-medium text-gray-700 mb-1.5">人员编号/昵称</label>
            <input
              type="text"
              placeholder="输入人员编号或昵称..."
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
        <WageRecordsTable
          filteredWageRecords={filteredWageRecords}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          rowEditingData={rowEditingData}
          setRowEditingData={setRowEditingData}
          roles={roles}
          roleMap={roleMap}
          formatDate={formatDate}
          formatWorkday={formatWorkday}
          startRowEditing={startRowEditing}
          saveRowEditing={saveRowEditing}
          cancelRowEditing={cancelRowEditing}
          handleDeleteRecord={handleDeleteRecord}
        />
      )}
    </div>
  )
}
