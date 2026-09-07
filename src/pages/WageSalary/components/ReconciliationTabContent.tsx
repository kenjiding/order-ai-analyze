// @ts-nocheck
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('wageSalary')

  return (
    <div className="space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title py-3">
          <h3 className="text-base font-semibold text-slate-950">{t('reconciliation.financeUploadTitle')}</h3>
          <p className="admin-description mt-0.5 text-xs leading-5">{t('reconciliation.financeUploadDesc')}</p>
        </div>

        <div className="border-b border-slate-200 px-5 py-3 space-y-3">
          <WageFileUploadBar
            variant="finance"
            title={t('reconciliation.financeDataTitle')}
            description={t('upload.fileFormats')}
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
