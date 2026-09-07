import { Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useAttendanceWorkTimePage } from './useAttendanceWorkTimePage'
import { AttendanceRecordListMobile } from './components/mobile/AttendanceRecordListMobile'
import { AddAttendanceButtonMobile } from './components/mobile/AddAttendanceButtonMobile'
import { AttendanceRecordVantPopup } from './components/mobile/AttendanceRecordVantPopup'
import { AttendanceFilterBar } from './components/pc/AttendanceFilterBar'
import { AttendanceRecordListPc } from './components/pc/AttendanceRecordListPc'
import { AddAttendanceButtonPc } from './components/pc/AddAttendanceButtonPc'
import { AddAttendanceRecordDialog } from './components/pc/AddAttendanceRecordDialog'
import './attendanceWorkTime.css'

export default function AttendanceWorkTimePage() {
  const { t } = useTranslation('attendanceWorkTime')
  const isMobile = useIsMobile()
  const page = useAttendanceWorkTimePage(isMobile)

  if (isMobile) {
    return (
      <div className="attendance-work-time-page attendance-work-time-page--mobile">
        <AttendanceRecordListMobile
          records={page.records}
          loading={page.loading}
          onEdit={page.openEdit}
          onDelete={page.removeRecord}
          onQuickFinish={page.quickFinishRecord}
        />
        <AddAttendanceButtonMobile onClick={page.openCreate} />
        <AttendanceRecordVantPopup
          open={page.dialogOpen}
          editing={page.editingRecord}
          ownRegionCode={page.ownRegionCode}
          workerSuggestions={page.workerSuggestions}
          workerSearchLoading={page.workerSearchLoading}
          onSearchWorker={page.searchWorkers}
          onCancel={page.closeDialog}
          onSubmit={page.submitRecord}
        />
      </div>
    )
  }

  return (
    <div className="admin-page attendance-work-time-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <Timer className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('page.title')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('page.description')}</p>
            </div>
          </div>
          <AddAttendanceButtonPc onClick={page.openCreate} />
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <AttendanceFilterBar
          regionCode={page.filters.regionCode}
          dateRange={page.filters.dateRange}
          isSuperAdmin={page.isSuperAdmin}
          ownRegionCode={page.ownRegionCode}
          onChangeRegion={page.setRegionFilter}
          onChangeDateRange={page.setDateRangeFilter}
        />
      </section>

      <section className="admin-panel p-4 sm:p-5">
        <AttendanceRecordListPc
          records={page.records}
          loading={page.loading}
          onEdit={page.openEdit}
          onDelete={page.removeRecord}
          onQuickFinish={page.quickFinishRecord}
        />
      </section>

      <AddAttendanceRecordDialog
        open={page.dialogOpen}
        editing={page.editingRecord}
        isSuperAdmin={page.isSuperAdmin}
        ownRegionCode={page.ownRegionCode}
        workerSuggestions={page.workerSuggestions}
        workerSearchLoading={page.workerSearchLoading}
        onSearchWorker={page.searchWorkers}
        onCancel={page.closeDialog}
        onSubmit={page.submitRecord}
      />
    </div>
  )
}
