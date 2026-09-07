import { useTranslation } from 'react-i18next'
import { Select } from 'antd'
import { formatCainiaoSharePercent } from '../cainiaoWaybill'
import type { EfficiencyAiAnalysis, EfficiencyInsightAiProvider } from '../efficiencyInsightApi'

export type { EfficiencyAiAnalysis, EfficiencyInsightAiProvider }

const AI_PROVIDER_OPTIONS: { value: EfficiencyInsightAiProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
]

type Props = {
  tab: 'warehouse' | 'scanner'
  aiProvider: EfficiencyInsightAiProvider
  onProviderChange: (v: EfficiencyInsightAiProvider) => void
  loading: boolean
  error: string
  analysis: EfficiencyAiAnalysis | null
  onGenerate: () => void
}

export function EfficiencyAiInsightBlock({
  tab,
  aiProvider,
  onProviderChange,
  loading,
  error,
  analysis,
  onGenerate,
}: Props) {
  const { t } = useTranslation('scannerEfficiency')
  return (
    <section className="se-ai-insight-block admin-panel overflow-hidden">
      <div className="se-ai-insight-header">
        <div className="se-ai-insight-header-left">
          <span className="se-ai-insight-icon">✦</span>
          <span className="se-ai-insight-title">{t('ai.title')}</span>
          <span className="se-ai-insight-subtitle">
            {tab === 'warehouse' ? t('ai.warehouseContext') : t('ai.scannerContext')}
          </span>
        </div>
        <div className="se-ai-insight-actions">
          <Select
            value={aiProvider}
            onChange={(v) => onProviderChange(v)}
            options={AI_PROVIDER_OPTIONS}
            style={{ width: 112 }}
          />
          <button
            type="button"
            className="se-ai-insight-btn"
            onClick={onGenerate}
            disabled={loading}
          >
            {loading ? t('ai.analyzing') : analysis ? t('ai.regenerate') : t('ai.start')}
          </button>
        </div>
      </div>

      {error && (
        <div className="se-ai-insight-error">{error}</div>
      )}

      {loading && !analysis && (
        <div className="se-ai-insight-loading">
          <div className="se-ai-insight-loading-dots">
            <span /><span /><span />
          </div>
          <span>{t('ai.loadingDetail')}</span>
        </div>
      )}

      {analysis && !loading && (
        <div className="se-ai-insight-body">
          {analysis.findings.length > 0 && (
            <div className="se-ai-insight-section">
              <div className="se-ai-insight-section-label se-ai-insight-label-findings">{t('ai.findings')}</div>
              <ul className="se-ai-insight-list">
                {analysis.findings.map((item, i) => (
                  <li key={i} className="se-ai-insight-item se-ai-insight-item-finding">
                    <span className="se-ai-insight-bullet" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.suggestions.length > 0 && (
            <div className="se-ai-insight-section">
              <div className="se-ai-insight-section-label se-ai-insight-label-suggestions">{t('ai.suggestions')}</div>
              <ul className="se-ai-insight-list">
                {analysis.suggestions.map((item, i) => (
                  <li key={i} className="se-ai-insight-item se-ai-insight-item-suggestion">
                    <span className="se-ai-insight-bullet" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'scanner' && analysis.topPerformers.length > 0 && (
            <div className="se-ai-insight-section">
              <div className="se-ai-insight-section-label se-ai-insight-label-top-performers">
                {t('ai.topPerformers')}
              </div>
              <div className="se-ai-top-performers-grid">
                {analysis.topPerformers.map((p, i) => (
                  <div key={i} className="se-ai-top-performer-card">
                    <div className="se-ai-top-performer-rank">{i + 1}</div>
                    <div className="se-ai-top-performer-body">
                      <div className="se-ai-top-performer-name-row">
                        <div className="se-ai-top-performer-name">{p.scanner}</div>
                        <div className="se-ai-top-performer-cainiao">
                          {t('columns.cainiaoShare')} {formatCainiaoSharePercent(p.cainiaoShare)}
                        </div>
                      </div>
                      {p.reason && (
                        <div className="se-ai-top-performer-reason">{p.reason}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!analysis && !loading && !error && (
        <div className="se-ai-insight-placeholder">
          {t('ai.placeholder')}
        </div>
      )}
    </section>
  )
}
