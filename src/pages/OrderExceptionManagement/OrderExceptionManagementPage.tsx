import { AnalysisTabContent } from './components/AnalysisTabContent'
import { JobsTabContent } from './components/JobsTabContent'
import { RegressionTestTabContent } from './components/RegressionTestTabContent'
import { WarehouseConfigTabContent } from './components/WarehouseConfigTabContent'
import { OrderExceptionManagementHeader } from './components/OrderExceptionManagementHeader'
import { useOrderExceptionManagementPage } from './useOrderExceptionManagementPage'

export default function OrderExceptionManagementPage() {
  const v = useOrderExceptionManagementPage()

  return (
    <div className="admin-page order-exception-page space-y-5">
      <OrderExceptionManagementHeader
        activeTab={v.activeTab}
        onTabChange={v.setActiveTab}
        activeJobCount={v.activeJobCount}
      />

      {v.activeTab === 'analyze' && (
        <AnalysisTabContent
          analyzeOrderText={v.analyzeOrderText}
          onAnalyzeOrderTextChange={v.setAnalyzeOrderText}
          analyzeAiProvider={v.analyzeAiProvider}
          onAnalyzeAiProviderChange={v.setAnalyzeAiProvider}
          batchAnalyze={v.batchAnalyze}
          onBatchAnalyzeChange={v.setBatchAnalyze}
          onAnalyze={v.onAnalyze}
          onAnalyzeOrderFileUpload={v.onAnalyzeOrderFileUpload}
          onClearImportedAnalyzeOrders={v.onClearImportedAnalyzeOrders}
          importedAnalyzeOrders={v.importedAnalyzeOrders}
          isAnalyzing={v.isAnalyzing}
          rows={v.analysisRows}
          filteredRows={v.filteredAnalysisRows}
          totalDoneRowCount={v.analysisRows.filter((r) => r.status === 'done').length}
          analyzeProgress={v.analyzeProgress}
          submittedJobBanner={v.submittedJobBanner}
          onDismissSubmittedJobBanner={v.dismissSubmittedJobBanner}
          onGoToJobsTab={() => v.setActiveTab('jobs')}
          tokenUsage={v.analyzeTokenUsage}
          analyzedOrderCount={v.lastAnalyzeOrderCount}
          durationMs={v.analyzeDurationMs}
          apiTiming={v.analyzeApiTiming}
          onOpenWarehouseConfig={() => v.setActiveTab('warehouse-config')}
          postFilterDraft={v.postFilterDraft}
          onPostFilterDraftChange={v.setPostFilterDraft}
          appliedPostFilter={v.appliedPostFilter}
          onRunPostFilter={v.runPostFilter}
        />
      )}

      {v.activeTab === 'jobs' && (
        <JobsTabContent
          jobs={v.jobsList}
          isLoading={v.isJobsLoading}
          onRefresh={() => void v.refreshJobs()}
          onLoadResults={(jobId) => void v.loadJobResults(jobId)}
          onCancel={(jobId) => void v.cancelJobById(jobId)}
          onDelete={(jobId) => void v.deleteJobById(jobId)}
          onRetry={(job) => void v.retryJob(job)}
        />
      )}

      {v.activeTab === 'warehouse-config' && (
        <WarehouseConfigTabContent
          draftConfig={v.warehouseDraftConfig}
          savedConfig={v.warehouseSavedConfig}
          selectedHubId={v.selectedWarehouseHubId}
          onDraftConfigChange={v.setWarehouseDraftConfig}
          onSelectedHubIdChange={v.setSelectedWarehouseHubId}
          onSave={v.persistWarehouseConfig}
          onResetDefaults={v.resetWarehouseConfig}
          isSaving={v.isSavingWarehouseConfig}
        />
      )}

      {v.activeTab === 'regression' && (
        <RegressionTestTabContent
          captureOrderNo={v.captureOrderNo}
          onCaptureOrderNoChange={v.setCaptureOrderNo}
          captureLossScope={v.captureLossScope}
          onCaptureLossScopeChange={v.setCaptureLossScope}
          captureSubType={v.captureSubType}
          onCaptureSubTypeChange={v.setCaptureSubType}
          captureReason={v.captureReason}
          onCaptureReasonChange={v.setCaptureReason}
          onCapture={v.onCaptureRegression}
          isCapturing={v.isCapturing}
          cases={v.regressionCases}
          onRefreshCases={() => void v.loadRegressionCases()}
          onDeleteCase={(id) => void v.onDeleteRegressionCase(id)}
          isDeletingId={v.isDeletingRegressionId}
          analyzeAiProvider={v.analyzeAiProvider}
          onAnalyzeAiProviderChange={v.setAnalyzeAiProvider}
          onRunRegression={v.onRunRegression}
          isRunningRegression={v.isRunningRegression}
          regressionResults={v.regressionResults}
          regressionSummary={v.regressionSummary}
          regressionTokenUsage={v.regressionTokenUsage}
        />
      )}
    </div>
  )
}
