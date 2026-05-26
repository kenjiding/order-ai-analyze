// @ts-nocheck
import { useWageSalaryPage } from './useWageSalaryPage'
import { WageSalaryPageHeader } from './components/WageSalaryPageHeader'
import { RateSettingsModal } from './components/RateSettingsModal'
import { ActualWorkerRatesModal } from './components/ActualWorkerRatesModal'
import { UploadTabContent } from './components/UploadTabContent'
import { WageRecordsPanel } from './components/WageRecordsPanel'
import { EmployeesTabContent } from './components/EmployeesTabContent'

export default function WageSalaryPage() {
  const v = useWageSalaryPage()

  return (
    <div className="admin-page wage-page space-y-5">
      <WageSalaryPageHeader
        statistics={v.statistics}
        activeTab={v.activeTab}
        onTabUpload={() => v.setActiveTab('upload')}
        onTabEmployees={() => v.setActiveTab('employees')}
        onOpenRateSettings={() => v.setShowRateSettings(true)}
        onOpenActualWorkerRates={() => v.setShowActualWorkerRates(true)}
      />

      <RateSettingsModal
        isOpen={v.showRateSettings}
        onClose={() => v.setShowRateSettings(false)}
        rateSettings={v.rateSettings}
        setRateSettings={v.setRateSettings}
        roleMap={v.roleMap}
        persistRateSettings={v.persistRateSettings}
        resetRateSettings={v.resetRateSettings}
      />

      <ActualWorkerRatesModal
        isOpen={v.showActualWorkerRates}
        onClose={() => v.setShowActualWorkerRates(false)}
        actualWorkerRateSettings={v.actualWorkerRateSettings}
        setActualWorkerRateSettings={v.setActualWorkerRateSettings}
        roleMap={v.roleMap}
        persistActualWorkerRateSettings={v.persistActualWorkerRateSettings}
        resetActualWorkerRateSettings={v.resetActualWorkerRateSettings}
      />

      {v.activeTab === 'upload' && (
        <div className="space-y-6">
          <UploadTabContent
            isSorting={v.isSorting}
            setIsSorting={v.setIsSorting}
            isPublicHoliday={v.isPublicHoliday}
            setIsPublicHoliday={v.setIsPublicHoliday}
            handleFileUpload={v.handleFileUpload}
            uploadedData={v.uploadedData}
            uploadedSourceFileName={v.uploadedSourceFileName}
            handleSubmitUpload={v.handleSubmitUpload}
            isUploading={v.isUploading}
            handleClearUploadedData={v.handleClearUploadedData}
            rateSettings={v.rateSettings}
            roleMap={v.roleMap}
            roles={v.roles}
            handleUpdateUploadedRole={v.handleUpdateUploadedRole}
            handleDayOptionChange={v.handleDayOptionChange}
            handleDeleteUploadedRow={v.handleDeleteUploadedRow}
            formatDate={v.formatDate}
            formatWorkday={v.formatWorkday}
          />
          <WageRecordsPanel
            wageRecords={v.wageRecords}
            filteredWageRecords={v.filteredWageRecords}
            searchQuery={v.searchQuery}
            setSearchQuery={v.setSearchQuery}
            searchRole={v.searchRole}
            setSearchRole={v.setSearchRole}
            searchStartDate={v.searchStartDate}
            setSearchStartDate={v.setSearchStartDate}
            searchEndDate={v.searchEndDate}
            setSearchEndDate={v.setSearchEndDate}
            roles={v.roles}
            roleMap={v.roleMap}
            handleExport={v.handleExport}
            billingVsActualSummary={v.billingVsActualSummary}
            onOpenActualWorkerRates={() => v.setShowActualWorkerRates(true)}
            paginatedRecords={v.paginatedRecords}
            currentPage={v.currentPage}
            setCurrentPage={v.setCurrentPage}
            pageSize={v.pageSize}
            setPageSize={v.setPageSize}
            totalPages={v.totalPages}
            rowEditingData={v.rowEditingData}
            setRowEditingData={v.setRowEditingData}
            formatDate={v.formatDate}
            formatWorkday={v.formatWorkday}
            startRowEditing={v.startRowEditing}
            saveRowEditing={v.saveRowEditing}
            cancelRowEditing={v.cancelRowEditing}
            handleDeleteRecord={v.handleDeleteRecord}
          />
        </div>
      )}

      {v.activeTab === 'employees' && (
        <EmployeesTabContent
          employees={v.employees}
          editingEmployeeId={v.editingEmployeeId}
          setEditingEmployeeId={v.setEditingEmployeeId}
          tempRole={v.tempRole}
          setTempRole={v.setTempRole}
          roles={v.roles}
          roleMap={v.roleMap}
          handleUpdateEmployeeRole={v.handleUpdateEmployeeRole}
          handleDeleteEmployee={v.handleDeleteEmployee}
        />
      )}
    </div>
  )
}
