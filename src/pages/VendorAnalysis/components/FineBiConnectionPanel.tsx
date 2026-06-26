import { Collapse, Input, Switch, Typography } from 'antd'
import { CheckCircle2, Link2 } from 'lucide-react'
import type { FineBiConnectionConfig } from '../fineBiConnectionStorage'
import {
  FINEBI_METRIC_NOT_MET_24H_LABEL,
  parseFineBiWidgetDataUrl,
} from '../fineBiConnectionStorage'

type Props = {
  connections: FineBiConnectionConfig[]
  onChange: (next: FineBiConnectionConfig[]) => void
}

function ConnectionSlot({
  index,
  config,
  onPatch,
}: {
  index: number
  config: FineBiConnectionConfig
  onPatch: (patch: Partial<FineBiConnectionConfig>) => void
}) {
  const parsed = parseFineBiWidgetDataUrl(config.widgetDataUrl)
  const slotHint =
    index === 0
      ? '指标 1：11点前出仓率'
      : '指标 2：24小时签派率 · 指标 3：24小时签收未达标（自动计算）'

  return (
    <div className="space-y-3 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-surface-soft)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">#{index + 1}</span>
          <Input
            value={config.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder="接口名称"
            className="w-48"
          />
          <span className="text-xs text-slate-400">{slotHint}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>启用</span>
          <Switch checked={config.enabled} onChange={(enabled) => onPatch({ enabled })} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-slate-500">widget/data 完整 URL</label>
        <Input.TextArea
          value={config.widgetDataUrl}
          onChange={(e) => onPatch({ widgetDataUrl: e.target.value })}
          placeholder="https://de-finebi.../widget/data?engineType=1&reportId=...&link=eyJ..."
          autoSize={{ minRows: 2, maxRows: 5 }}
        />
        {parsed ? (
          <Typography.Text type="success" className="flex items-center gap-1 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已解析 reportId: {parsed.reportId}
          </Typography.Text>
        ) : config.widgetDataUrl.trim() ? (
          <Typography.Text type="danger" className="text-xs">
            URL 无效，需包含 reportId 与 link 查询参数
          </Typography.Text>
        ) : null}
      </div>

      <Collapse
        ghost
        className="finebi-connection-advanced"
        items={[
          {
            key: 'advanced',
            label: <span className="text-xs text-slate-500">高级（一般留空）</span>,
            children: (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-500">
                  FineBI Bearer（可选，无则仅用 link）
                </label>
                <Input.Password
                  value={config.authToken}
                  onChange={(e) => onPatch({ authToken: e.target.value })}
                  placeholder="留空即可（与 A 平台 token 无关）"
                  autoComplete="off"
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

export function FineBiConnectionPanel({ connections, onChange }: Props) {
  const patchAt = (index: number, patch: Partial<FineBiConnectionConfig>) => {
    const next = connections.map((c, i) => (i === index ? { ...c, ...patch } : c))
    onChange(next)
  }

  return (
    <Collapse
      ghost
      className="finebi-connection-panel"
      items={[
        {
          key: 'finebi',
          label: (
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--admin-accent)]">
              <Link2 className="h-3.5 w-3.5" />
              FineBI 连接配置（2 组 URL）
            </span>
          ),
          children: (
            <div className="space-y-4 pt-1">
              <Typography.Paragraph type="secondary" className="!mb-0 text-xs">
                粘贴 widget/data 完整 URL 即可。共 3 个 FineBI 指标：#1 出仓率、#2 签派率；
                「{FINEBI_METRIC_NOT_MET_24H_LABEL}」由 #2 返回的首派单量 − 24WH 签收单量自动得出，无需第三组 URL。
              </Typography.Paragraph>
              {connections.map((config, index) => (
                <ConnectionSlot
                  key={index}
                  index={index}
                  config={config}
                  onPatch={(patch) => patchAt(index, patch)}
                />
              ))}
            </div>
          ),
        },
      ]}
    />
  )
}
