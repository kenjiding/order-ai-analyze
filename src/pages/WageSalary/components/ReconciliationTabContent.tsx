// @ts-nocheck
import { WageFileUploadBar } from './WageFileUploadBar'
import { WageReconciliationPanel } from './WageReconciliationPanel'

export function ReconciliationTabContent({
  handleFinanceFileUpload,
  financeLedgerRows,
  financeSourceFileName,
  handleClearFinanceData,
  reconciliationResult,
  wageRecordsCount,
  onExportReconciliation,
}) {
  return (
    <div className="space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title py-3">
          <h3 className="text-base font-semibold text-slate-950">财务流水上传</h3>
          <p className="admin-description mt-0.5 text-xs leading-5">
            上传流水管理表，与当前批次系统计算结果对比工时、工资、职位与工作日差异
          </p>
        </div>

        <div className="border-b border-slate-200 px-5 py-3 space-y-3">
          <WageFileUploadBar
            variant="finance"
            title="流水管理数据"
            description="支持 .xlsx / .xls / .csv"
            sourceFileName={financeSourceFileName}
            recordCount={financeLedgerRows.length}
            onFileSelect={handleFinanceFileUpload}
            onClear={handleClearFinanceData}
          />
        </div>
      </div>

      <WageReconciliationPanel
        reconciliationResult={reconciliationResult}
        wageRecordsCount={wageRecordsCount}
        financeLedgerCount={financeLedgerRows.length}
        onExportReconciliation={onExportReconciliation}
        alwaysVisible
      />
    </div>
  )
}
