import { Button, Checkbox, Drawer, Tooltip, Typography } from 'antd'
import { Layers, SlidersHorizontal, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isSupplierPushEligible, type SupplierPushConfig } from '../../../shared/supplierPushConfig'
import {
  ALL_METRIC_KEYS,
  MODULE_METRICS,
  mergeModuleMetricKeys,
} from '../metricsRegistry'
import type { PublicJob } from '../vendorAnalysisApi'

type JobOutputConfig = {
  pushEnabledIds: string[]
  aiSummaryEnabled: boolean
  metricKeys: string[]
}

type Props = {
  open: boolean
  onClose: () => void
  /** 正在编辑的任务；null 时抽屉不渲染内容 */
  job: PublicJob | null
  catalogConfigs: SupplierPushConfig[]
  /** 保存输出配置；返回 true 表示成功（由此关闭抽屉） */
  onSave: (jobId: string, config: JobOutputConfig) => Promise<boolean>
}

/** 从任务 payload 读取当前输出配置，供编辑抽屉预填 */
function readConfig(job: PublicJob): JobOutputConfig {
  const p = job.payload
  const pushEnabledIds = Array.isArray(p.pushEnabledIds)
    ? (p.pushEnabledIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : []
  const metricKeys = Array.isArray(p.metricKeys)
    ? (p.metricKeys as unknown[]).filter((k): k is string => typeof k === 'string')
    : ALL_METRIC_KEYS
  return { pushEnabledIds, aiSummaryEnabled: p.aiSummaryEnabled !== false, metricKeys }
}

/**
 * 任务队列「编辑」抽屉：编辑不参与数据分析抓取的输出配置——
 * 推送供应商范围、AI 分析总结、扩展模块。改动通过 PATCH 落库、不重跑 worker。
 * 供应商/司机指标已固化，如需变更请新建分析任务。
 */
export function EditJobConfigDrawer({ open, onClose, job, catalogConfigs, onSave }: Props) {
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(true)
  const [moduleKeys, setModuleKeys] = useState<Set<string>>(new Set())
  const [baseMetricKeys, setBaseMetricKeys] = useState<string[]>(ALL_METRIC_KEYS)
  const [saving, setSaving] = useState(false)
  const [syncedKey, setSyncedKey] = useState<string | null>(null)

  // 每次打开（或切换任务）用任务当前配置重置本地编辑态。用「渲染期按 key 同步」而非 effect：
  // 避免 setState-in-effect 的级联渲染，也是 React 推荐的「随 props 变化派生 state」写法。
  const activeKey = open && job ? job.id : null
  if (activeKey !== syncedKey) {
    setSyncedKey(activeKey)
    if (activeKey && job) {
      const cfg = readConfig(job)
      setEnabledIds(new Set(cfg.pushEnabledIds))
      setAiSummaryEnabled(cfg.aiSummaryEnabled)
      setBaseMetricKeys(cfg.metricKeys)
      setModuleKeys(new Set(MODULE_METRICS.filter((m) => cfg.metricKeys.includes(m.key)).map((m) => m.key)))
    }
  }

  const eligibleConfigs = useMemo(() => catalogConfigs.filter(isSupplierPushEligible), [catalogConfigs])
  const selectedCount = catalogConfigs.filter((c) => enabledIds.has(c.id) && isSupplierPushEligible(c)).length
  const allEligibleSelected = eligibleConfigs.length > 0 && selectedCount === eligibleConfigs.length

  const toggle = (id: string, next: boolean) => {
    setEnabledIds((prev) => {
      const set = new Set(prev)
      if (next) set.add(id)
      else set.delete(id)
      return set
    })
  }

  const toggleModule = (key: string, next: boolean) => {
    setModuleKeys((prev) => {
      const set = new Set(prev)
      if (next) set.add(key)
      else set.delete(key)
      return set
    })
  }

  const handleSave = async () => {
    if (!job) return
    setSaving(true)
    try {
      const metricKeys = mergeModuleMetricKeys(baseMetricKeys, [...moduleKeys])
      const ok = await onSave(job.id, {
        pushEnabledIds: [...enabledIds],
        aiSummaryEnabled,
        metricKeys,
      })
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={640}
      maskClosable={!saving}
      title={
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          <span>编辑任务配置</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>保存</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Typography.Paragraph type="secondary" className="!mb-0 text-xs leading-relaxed">
          可编辑「推送供应商配置」和「扩展模块」。其中「AI 分析总结」仅影响展示/推送，改完无需重跑分析；
          「司机地图」若分析时未勾选，事后打开只会显示空地图——必须新建任务并勾选后重新分析才会同步运单坐标。
          供应商/司机指标已固化，如需变更请新建分析任务。
        </Typography.Paragraph>

        <section className="rounded-xl border border-[var(--admin-line)] bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
                <Truck className="h-4 w-4" aria-hidden />
              </span>
              <h4 className="text-sm font-semibold text-slate-800">推送供应商配置</h4>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={allEligibleSelected || eligibleConfigs.length === 0}
                onClick={() => setEnabledIds(new Set(eligibleConfigs.map((c) => c.id)))}
              >
                全选
              </Button>
              <Button disabled={selectedCount === 0} onClick={() => setEnabledIds(new Set())}>清空</Button>
            </div>
          </header>
          <div className="px-4 py-4">
            {catalogConfigs.length === 0 ? (
              <p className="text-xs text-slate-400">暂无供应商配置，请前往「系统管理 → 供应商配置」维护。</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {catalogConfigs.map((c) => {
                  const checked = enabledIds.has(c.id)
                  const eligible = isSupplierPushEligible(c)
                  const nickname = c.supplierNickname?.trim()
                  const primary = nickname || c.vendorName || '未知供应商'
                  const showVendorLine = !!nickname && c.vendorName.trim().length > 0
                  const checkboxNode = (
                    <Checkbox
                      checked={checked}
                      disabled={!eligible}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                      className="flex w-full min-w-0 items-center [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:overflow-hidden"
                    >
                      <span className="flex min-w-0 flex-col leading-tight">
                        <Tooltip title={primary}>
                          <span className={`truncate text-[13px] font-semibold ${eligible ? 'text-slate-800' : 'text-slate-400'}`}>
                            {primary}
                          </span>
                        </Tooltip>
                        {showVendorLine && (
                          <Tooltip title={c.vendorName}>
                            <span className={`truncate text-[11px] font-medium ${eligible ? 'text-[var(--admin-accent)]' : 'text-slate-400'}`}>
                              {c.vendorName}
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </Checkbox>
                  )
                  return (
                    <label
                      key={c.id}
                      className={`flex min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-3 py-2.5 transition-colors ${
                        !eligible
                          ? 'cursor-default border-[var(--admin-line)] bg-[var(--admin-surface-soft)]'
                          : checked
                            ? 'cursor-pointer border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
                            : 'cursor-pointer border-[var(--admin-line)] bg-white hover:bg-slate-50'
                      }`}
                    >
                      {eligible ? (
                        checkboxNode
                      ) : (
                        <Tooltip title="该供应商未配置 Webhook，无法推送">
                          <span className="flex w-full min-w-0">{checkboxNode}</span>
                        </Tooltip>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            <p className="mt-3 border-t border-[var(--admin-line)] pt-3 text-[11px] text-slate-400">
              已选 {selectedCount} / {eligibleConfigs.length} 个可推送供应商
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--admin-line)] bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
                <Layers className="h-4 w-4" aria-hidden />
              </span>
              <h4 className="text-sm font-semibold text-slate-800">扩展模块</h4>
            </div>
            <span className="text-[11px] tabular-nums text-slate-400">
              已启用 {moduleKeys.size + (aiSummaryEnabled ? 1 : 0)} / {MODULE_METRICS.length + 1}
            </span>
          </header>
          <div className="px-4 py-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MODULE_METRICS.map((metric) => {
                const checked = moduleKeys.has(metric.key)
                return (
                  <label
                    key={metric.key}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                      checked
                        ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
                        : 'border-[var(--admin-line)] bg-white hover:bg-slate-50'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(e) => toggleModule(metric.key, e.target.checked)}
                    >
                      <span className="text-[13px] text-slate-700">{metric.label}</span>
                    </Checkbox>
                  </label>
                )
              })}
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                  aiSummaryEnabled
                    ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
                    : 'border-[var(--admin-line)] bg-white hover:bg-slate-50'
                }`}
              >
                <Checkbox
                  checked={aiSummaryEnabled}
                  onChange={(e) => setAiSummaryEnabled(e.target.checked)}
                >
                  <span className="text-[13px] text-slate-700">AI 分析总结</span>
                </Checkbox>
              </label>
            </div>
            <p className="mt-3 border-t border-[var(--admin-line)] pt-3 text-[11px] text-slate-400">
              AI 总结开关即时生效；司机地图依赖分析任务里的同步阶段，仅改开关不会补数据。已发布的外部分享链接需重新打开快照/发布日报后才会更新展示配置。
            </p>
          </div>
        </section>
      </div>
    </Drawer>
  )
}
