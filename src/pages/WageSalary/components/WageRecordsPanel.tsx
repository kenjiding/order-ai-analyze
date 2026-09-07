// @ts-nocheck
import { AlertCircle, Download, Search, X } from 'lucide-react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'

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
  const { t } = useTranslation('wageSalary')
  const canExport = usePermission(PERMISSION_KEYS.btnWageSalaryExport)
  const canEdit = usePermission(PERMISSION_KEYS.btnWageSalaryEdit)

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {t('records.title', { count: wageRecords.length })}
        </h3>
        <Tooltip title={!canExport ? t('records.noOperationPermission') : undefined}>
          <button
            type="button"
            onClick={handleExport}
            disabled={filteredWageRecords.length === 0 || !canExport}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              filteredWageRecords.length === 0 || !canExport
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            <Download className="w-4 h-4" />
            {t('records.exportExcel')}
          </button>
        </Tooltip>
      </div>

      <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('records.searchEmployee')}</label>
            <input
              type="text"
              placeholder={t('records.searchEmployeePlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('col.role')}</label>
            <select
              value={searchRole}
              onChange={(e) => setSearchRole(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">{t('records.allRoles')}</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {t(`role.${role}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('records.startDate')}</label>
            <input
              type="date"
              value={searchStartDate}
              onChange={(e) => setSearchStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">{t('records.endDate')}</label>
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
                  title={t('records.clearDates')}
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
            {t('records.search')}
          </button>
        </div>
      </div>

      {billingVsActualSummary && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/90 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-amber-950">{t('records.billingVsActualTitle')}</h4>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-600">{t('records.billingTotal')}</div>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                ${billingVsActualSummary.totalBilling.toFixed(2)}
              </div>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-600">{t('records.actualPayoutTotal')}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-600">
                ${billingVsActualSummary.totalActualPayout.toFixed(2)}
              </div>
            </div>
            <div className="rounded-md border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-gray-600">{t('records.supplierMargin')}</div>
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
          <p>{t('records.empty')}</p>
          <p className="text-sm mt-1">{t('records.emptyHint')}</p>
        </div>
      ) : filteredWageRecords.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p>{t('records.noFilterMatch')}</p>
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
          formatDate={formatDate}
          formatWorkday={formatWorkday}
          startRowEditing={startRowEditing}
          saveRowEditing={saveRowEditing}
          cancelRowEditing={cancelRowEditing}
          handleDeleteRecord={handleDeleteRecord}
          canEditRecord={canEdit}
        />
      )}
    </div>
  )
}
