// @ts-nocheck
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'

const STATUS_LABEL = {
  matched: '一致',
  fieldMismatch: '字段差异',
  systemOnly: '仅系统',
  financeOnly: '仅财务',
}

const STATUS_CLASS = {
  matched: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  fieldMismatch: 'bg-red-50 text-red-800 border-red-200',
  systemOnly: 'bg-blue-50 text-blue-800 border-blue-200',
  financeOnly: 'bg-orange-50 text-orange-800 border-orange-200',
}

function formatNum(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toFixed(2)
}

const DIFF_VALUE_CLASS = 'font-semibold tabular-nums text-red-600'

/** 数值差额：非零或强制标红（字段级差异但仍在容差内等边界情况） */
function diffValueClass(delta, forceRed = false) {
  if (forceRed) return DIFF_VALUE_CLASS
  if (delta == null || !Number.isFinite(delta)) return ''
  if (Math.abs(delta) <= 0.01) return ''
  return DIFF_VALUE_CLASS
}

function fieldDiffClass(hasDiff) {
  return hasDiff ? 'rounded px-1 font-medium text-red-600' : ''
}

export function WageReconciliationPanel({
  reconciliationResult,
  wageRecordsCount,
  financeLedgerCount,
  onExportReconciliation,
  alwaysVisible = false,
}) {
  const [showAll, setShowAll] = useState(false)

  const displayRows = useMemo(() => {
    if (!reconciliationResult) return []
    if (showAll) return reconciliationResult.rows
    return reconciliationResult.rows.filter((r) => r.status !== 'matched')
  }, [reconciliationResult, showAll])

  if (!alwaysVisible && financeLedgerCount === 0) return null

  if (financeLedgerCount === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">财务流水差异对比</h3>
        <p className="text-sm text-gray-600">请先上传财务流水文件，系统将自动与当前工资记录对比。</p>
      </div>
    )
  }

  if (wageRecordsCount === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">财务流水差异对比</h3>
        <p className="text-sm text-gray-600">已上传 {financeLedgerCount} 条财务流水。请先上传考勤并计算薪资后再对比。</p>
      </div>
    )
  }

  if (!reconciliationResult) return null

  const { summary } = reconciliationResult

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">财务流水差异对比</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 accent-blue-600"
            />
            显示全部（含一致）
          </label>
          <button
            type="button"
            onClick={onExportReconciliation}
            disabled={reconciliationResult.rows.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
          >
            <Download className="w-4 h-4" />
            导出差异对比
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/90 p-4">
        <h4 className="text-sm font-semibold text-violet-950 mb-3">汇总对照</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-violet-100 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium text-gray-600">总工时（财务 / 系统 / 差额）</div>
            <div className="mt-1 text-sm tabular-nums text-gray-900">
              {formatNum(summary.financeTotalHours)} / {formatNum(summary.systemTotalHours)}
              <span className={`ml-2 ${diffValueClass(summary.hoursDelta)}`}>
                Δ {formatNum(summary.hoursDelta)}
              </span>
            </div>
          </div>
          <div className="rounded-md border border-violet-100 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium text-gray-600">总工资（财务 / 系统 / 差额）</div>
            <div className="mt-1 text-sm tabular-nums text-gray-900">
              ${formatNum(summary.financeTotalWage)} / ${formatNum(summary.systemTotalWage)}
              <span className={`ml-2 ${diffValueClass(summary.wageDelta)}`}>
                Δ ${formatNum(summary.wageDelta)}
              </span>
            </div>
          </div>
          <div className="rounded-md border border-violet-100 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium text-gray-600">匹配统计</div>
            <div className="mt-1 text-sm text-gray-900">
              一致 {summary.matchedCount} · 差异 {summary.fieldMismatchCount} · 仅系统{' '}
              {summary.systemOnlyCount} · 仅财务 {summary.financeOnlyCount}
              {summary.duplicateFinanceKeyCount > 0 && (
                <span className="ml-1 text-orange-700">
                  （财务重复键 {summary.duplicateFinanceKeyCount}）
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {displayRows.length === 0 ? (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          所有记录均一致，无差异行。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">日期</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">人员(财/系/昵称)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">职位(财/系)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">工作日(财/系)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">工时(财/系/差)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">工资(财/系/差)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayRows.map((row, idx) => (
                <tr key={`${row.date}-${row.personLabel}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                    {row.duplicateFinanceKey && (
                      <span className="ml-1 text-xs text-orange-600" title="财务侧同日期+人员存在多行">
                        重复
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-900">{row.date || '-'}</td>
                  <td className="px-3 py-2 text-gray-900">
                    <div>
                      {row.financePersonName || '-'} / {row.systemPersonName || '-'} /{' '}
                      {row.systemPersonNickname || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <div className={fieldDiffClass(row.fieldDiffs.some((d) => d.kind === 'position'))}>
                      {row.financePosition || '-'} / {row.systemPosition || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    <div className={fieldDiffClass(row.fieldDiffs.some((d) => d.kind === 'workday'))}>
                      {row.financeWorkday || '-'} / {row.systemWorkday || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">
                    <span>{row.financeHours ?? '-'}</span>
                    <span className="text-gray-400 mx-1">/</span>
                    <span>{formatNum(row.systemHours)}</span>
                    <span
                      className={`ml-1 ${diffValueClass(
                        row.hoursDelta,
                        row.fieldDiffs.some((d) => d.kind === 'hours') ||
                          row.status === 'systemOnly' ||
                          row.status === 'financeOnly',
                      )}`}
                    >
                      / {row.hoursDelta != null ? formatNum(row.hoursDelta) : '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">
                    <span>{row.financeWage != null ? `$${formatNum(row.financeWage)}` : '-'}</span>
                    <span className="text-gray-400 mx-1">/</span>
                    <span>{row.systemWage != null ? `$${formatNum(row.systemWage)}` : '-'}</span>
                    <span
                      className={`ml-1 ${diffValueClass(
                        row.wageDelta,
                        row.fieldDiffs.some((d) => d.kind === 'wage') ||
                          row.status === 'systemOnly' ||
                          row.status === 'financeOnly',
                      )}`}
                    >
                      / {row.wageDelta != null ? `$${formatNum(row.wageDelta)}` : '-'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
