import { Select } from 'antd'
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
  return (
    <section className="se-ai-insight-block admin-panel overflow-hidden">
      <div className="se-ai-insight-header">
        <div className="se-ai-insight-header-left">
          <span className="se-ai-insight-icon">✦</span>
          <span className="se-ai-insight-title">AI 数据分析建议</span>
          <span className="se-ai-insight-subtitle">
            {tab === 'warehouse' ? '基于开仓效率 / 总体效率数据' : '基于分拣员个人效率数据'}
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
            {loading ? '分析中…' : analysis ? '重新分析' : '开始分析'}
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
          <span>正在分析数据，请稍候…</span>
        </div>
      )}

      {analysis && !loading && (
        <div className="se-ai-insight-body">
          {analysis.findings.length > 0 && (
            <div className="se-ai-insight-section">
              <div className="se-ai-insight-section-label se-ai-insight-label-findings">数据亮点 / 问题</div>
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
              <div className="se-ai-insight-section-label se-ai-insight-label-suggestions">改进建议</div>
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
                值得奖励的员工
              </div>
              <div className="se-ai-top-performers-grid">
                {analysis.topPerformers.map((p, i) => (
                  <div key={i} className="se-ai-top-performer-card">
                    <div className="se-ai-top-performer-rank">{i + 1}</div>
                    <div className="se-ai-top-performer-body">
                      <div className="se-ai-top-performer-name">{p.scanner}</div>
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
          点击「开始分析」，AI 将根据当前数据自动生成运营建议。
        </div>
      )}
    </section>
  )
}
