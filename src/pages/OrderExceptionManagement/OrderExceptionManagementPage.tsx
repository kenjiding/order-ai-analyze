import { AnalysisTabContent } from './components/AnalysisTabContent'
import { RegressionTestTabContent } from './components/RegressionTestTabContent'
import { OrderExceptionManagementHeader } from './components/OrderExceptionManagementHeader'
import { useOrderExceptionManagementPage } from './useOrderExceptionManagementPage'

export default function OrderExceptionManagementPage() {
  const v = useOrderExceptionManagementPage()

  return (
    <div className="admin-page order-exception-page space-y-5">
      <OrderExceptionManagementHeader
        activeTab={v.activeTab}
        onTabChange={v.setActiveTab}
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
          isAnalyzing={v.isAnalyzing}
          rows={v.analysisRows}
          analyzeProgress={v.analyzeProgress}
          tokenUsage={v.analyzeTokenUsage}
          analyzedOrderCount={v.lastAnalyzeOrderCount}
          durationMs={v.analyzeDurationMs}
          apiTiming={v.analyzeApiTiming}
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
