import { DollarSign, Scale, Settings, Upload, Users } from 'lucide-react'

type Statistics = { totalWages: number; totalHours: number; totalRecords: number } | null

type Props = {
  statistics: Statistics
  activeTab: string
  onTabUpload: () => void
  onTabEmployees: () => void
  onOpenRateSettings: () => void
  onOpenActualWorkerRates: () => void
}

export function WageSalaryPageHeader({
  statistics,
  activeTab,
  onTabUpload,
  onTabEmployees,
  onOpenRateSettings,
  onOpenActualWorkerRates,
}: Props) {
  return (
    <div className="admin-panel overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="admin-eyebrow">Payroll Operations</div>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
              <DollarSign className="h-5 w-5 text-[#2f8f87]" />
              工资结算系统
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {statistics && (
              <>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <div className="text-xs font-medium text-slate-500">总工资</div>
                  <div className="mt-1 text-xl font-semibold text-[#2f8f87]">
                    ${statistics.totalWages.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <div className="text-xs font-medium text-slate-500">总工时</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {statistics.totalHours.toFixed(2)}h
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                  <div className="text-xs font-medium text-slate-500">记录数</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">{statistics.totalRecords}</div>
                </div>
              </>
            )}
            <button type="button" onClick={onOpenRateSettings} className="admin-btn admin-btn-dark">
              <Settings className="w-4 h-4" />
              时薪设置
            </button>
            <button
              type="button"
              onClick={onOpenActualWorkerRates}
              className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
              title="设置供应商发给小工/叉车/前台的真实时薪，用于与对账差额对照"
            >
              <Scale className="w-4 h-4" />
              实际时薪
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <div className="flex space-x-8">
          <button
            type="button"
            onClick={onTabUpload}
            className={`pb-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
              activeTab === 'upload'
                ? 'border-[#2f8f87] text-[#2f8f87]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Upload className="w-4 h-4" />
            文件上传
          </button>
          <button
            type="button"
            onClick={onTabEmployees}
            className={`pb-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
              activeTab === 'employees'
                ? 'border-[#2f8f87] text-[#2f8f87]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Users className="w-4 h-4" />
            员工管理
          </button>
        </div>
      </div>
    </div>
  )
}
