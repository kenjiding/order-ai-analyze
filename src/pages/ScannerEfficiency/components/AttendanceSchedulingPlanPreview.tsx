import type { AttendanceSchedulingPlanPreview } from '../attendanceSchedulingPlanPreviewModel'
import {
  SCHEDULING_PLAN_HOURS_STRUCTURE,
  SCHEDULING_PLAN_PROCESSES,
} from '../attendanceSchedulingPlanPreviewModel'
import '../attendanceSchedulingPlanPreview.css'

type Props = {
  preview: AttendanceSchedulingPlanPreview
  cellTexts: Record<string, string>
  onCellChange: (key: string, text: string) => void
}

export default function AttendanceSchedulingPlanPreviewView({ preview, cellTexts, onCellChange }: Props) {
  const { planDate } = preview
  const k = (suffix: string) => `${planDate}:${suffix}`
  const v = (suffix: string) => cellTexts[k(suffix)] ?? ''

  // Editable cell – user types into this
  const Ed = ({
    suffix,
    className = 'sp-cell',
  }: {
    suffix: string
    className?: string
  }) => (
    <td
      className={className}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => onCellChange(k(suffix), e.currentTarget.innerText.trim())}
    >
      {v(suffix)}
    </td>
  )

  // Read-only computed cell
  const Ro = ({
    suffix,
    className = 'sp-cell sp-cell--computed',
  }: {
    suffix: string
    className?: string
  }) => (
    <td className={className}>{v(suffix)}</td>
  )

  return (
    <div className="sp-plan">
      {/* ── Title bar ── */}
      <div className="sp-title-bar">
        <div
          className="sp-title-text"
          contentEditable
          suppressContentEditableWarning
          onBlur={(e) => onCellChange(k('title'), e.currentTarget.innerText.trim())}
        >
          {v('title')}
        </div>
      </div>

      {/* ── Section 1: 总体情况 ── */}
      <div className="sp-section">
        <div className="sp-section-hd sp-section-hd--s1">1. 总体情况</div>
        <table className="sp-table">
          <thead>
            <tr>
              <th>入站件量</th>
              <th>粗分件量</th>
              <th>细分件量</th>
              <th>总工时</th>
              <th>总人数</th>
              <th>总效率（件/时）</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Ed suffix="s1-inbound" className="sp-cell sp-cell--s1-value" />
              <Ed suffix="s1-coarse"  className="sp-cell sp-cell--s1-value" />
              <Ed suffix="s1-fine"    className="sp-cell sp-cell--s1-value" />
              <Ro suffix="s1-hours"   className="sp-cell sp-cell--s1-value sp-cell--computed sp-cell--hours" />
              <Ro suffix="s1-count"   className="sp-cell sp-cell--s1-value sp-cell--computed" />
              <Ro suffix="s1-total-eff" className="sp-cell sp-cell--s1-value sp-cell--computed sp-cell--eff" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Section 2: 上一日人效达成复盘及建议 ── */}
      <div className="sp-section">
        <div className="sp-section-hd sp-section-hd--s2">2. 上一日人效达成复盘及建议</div>
        <table className="sp-table">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>工序</th>
              <th>上一日件量</th>
              <th>上一日投入工时</th>
              <th>实际人效</th>
              <th>目标人效</th>
              <th>达成率</th>
              <th>偏差</th>
              <th>判断</th>
              <th>原因说明</th>
              <th>次日调整建议</th>
              <th>调整岗位/时段</th>
            </tr>
          </thead>
          <tbody>
            {SCHEDULING_PLAN_PROCESSES.map((proc, idx) => (
              <tr key={proc.id}>
                <td className="sp-cell sp-cell--label">{proc.label}</td>
                <Ed suffix={`s2-${idx}-qty`}       className="sp-cell sp-cell--num" />
                <Ed suffix={`s2-${idx}-workhours`} className="sp-cell sp-cell--num" />
                <Ed suffix={`s2-${idx}-actual`}    className="sp-cell sp-cell--num" />
                <Ed suffix={`s2-${idx}-target`}    className="sp-cell sp-cell--num" />
                <Ro suffix={`s2-${idx}-rate`}      className="sp-cell sp-cell--rate sp-cell--computed" />
                <Ed suffix={`s2-${idx}-gap`}       className="sp-cell sp-cell--num" />
                <Ed suffix={`s2-${idx}-verdict`}   className="sp-cell sp-cell--verdict" />
                <Ed suffix={`s2-${idx}-reason`}    className="sp-cell sp-cell--text-left" />
                <Ed suffix={`s2-${idx}-suggest`}   className="sp-cell sp-cell--text-left" />
                <Ed suffix={`s2-${idx}-adjust`}    className="sp-cell sp-cell--num" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Sections 3A / 3B side by side ── */}
      <div className="sp-row-3">
        {/* 3A: 工时结构分析 */}
        <div className="sp-section sp-section--3a">
          <div className="sp-section-hd sp-section-hd--s3a">3A. 工时结构分析</div>
          <table className="sp-table">
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '26%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>工时类型</th>
                <th>口径说明</th>
                <th>预计工时</th>
                <th>占比</th>
                <th>数据来源</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {SCHEDULING_PLAN_HOURS_STRUCTURE.map(({ type, label, desc, source }) => {
                const isAutoComputed = type === 'direct' || type === 'indirect'
                return (
                  <tr key={type}>
                    <td className="sp-cell sp-cell--label">{label}</td>
                    <td className="sp-cell sp-cell--desc">{desc}</td>
                    {isAutoComputed ? (
                      <Ro suffix={`s3a-${type}-hours`} className="sp-cell sp-cell--num sp-cell--computed" />
                    ) : (
                      <Ed suffix={`s3a-${type}-hours`} className="sp-cell sp-cell--num" />
                    )}
                    {isAutoComputed ? (
                      <Ro suffix={`s3a-${type}-ratio`} className="sp-cell sp-cell--num sp-cell--computed" />
                    ) : (
                      <Ed suffix={`s3a-${type}-ratio`} className="sp-cell sp-cell--num" />
                    )}
                    <td className="sp-cell sp-cell--desc">{source}</td>
                    <Ed suffix={`s3a-${type}-note`} className="sp-cell sp-cell--text-left" />
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* 3B: 按工序小计 */}
        <div className="sp-section sp-section--3b">
          <div className="sp-section-hd sp-section-hd--s3b">3B. 按工序小计</div>
          <table className="sp-table">
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>工序</th>
                <th>预计工时</th>
                <th>工时占比</th>
                <th>需求人数</th>
              </tr>
            </thead>
            <tbody>
              {SCHEDULING_PLAN_PROCESSES.map((proc, idx) => (
                <tr key={proc.id}>
                  <td className="sp-cell sp-cell--label">{proc.label}</td>
                  <Ro suffix={`s3b-${idx}-hours`} className="sp-cell sp-cell--num sp-cell--computed" />
                  <Ro suffix={`s3b-${idx}-ratio`} className="sp-cell sp-cell--rate sp-cell--computed" />
                  <Ro suffix={`s3b-${idx}-count`} className="sp-cell sp-cell--num sp-cell--computed" />
                </tr>
              ))}
              <tr className="sp-row--total">
                <td className="sp-cell sp-cell--total-label">合计</td>
                <Ro suffix="s3b-total-hours" className="sp-cell sp-cell--total-num sp-cell--computed" />
                <Ro suffix="s3b-total-ratio" className="sp-cell sp-cell--total-num sp-cell--computed" />
                <Ro suffix="s3b-total-count" className="sp-cell sp-cell--total-num sp-cell--computed" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: 次日岗位出勤明细 ── */}
      <div className="sp-section">
        <div className="sp-section-hd sp-section-hd--s4">4. 次日岗位出勤明细</div>
        <table className="sp-table">
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>工序</th>
              <th>岗位</th>
              <th>预计件量</th>
              <th>岗位效率</th>
              <th>需求出勤人数</th>
              <th>计划上班时间</th>
              <th>计划下班时间</th>
              <th>预计出勤工时</th>
              <th>工时占比</th>
              <th>备注</th>
              <th>数据口径</th>
            </tr>
          </thead>
          <tbody>
            {SCHEDULING_PLAN_PROCESSES.map((proc, idx) => (
              <tr key={proc.id}>
                <td className="sp-cell sp-cell--label">{proc.label}</td>
                <Ed suffix={`s4-${idx}-position`} className="sp-cell sp-cell--num" />
                <Ed suffix={`s4-${idx}-qty`}      className="sp-cell sp-cell--num" />
                <Ed suffix={`s4-${idx}-eff`}      className="sp-cell sp-cell--num" />
                <Ed suffix={`s4-${idx}-count`}    className="sp-cell sp-cell--num" />
                <Ed suffix={`s4-${idx}-start`}    className="sp-cell sp-cell--num" />
                <Ed suffix={`s4-${idx}-end`}      className="sp-cell sp-cell--num" />
                <Ro suffix={`s4-${idx}-hours`}    className="sp-cell sp-cell--num sp-cell--computed" />
                <Ro suffix={`s4-${idx}-hratio`}   className="sp-cell sp-cell--rate sp-cell--computed" />
                <Ed suffix={`s4-${idx}-remark`}   className="sp-cell sp-cell--text-left" />
                <Ed suffix={`s4-${idx}-source`}   className="sp-cell sp-cell--source" />
              </tr>
            ))}
            <tr className="sp-row--total">
              <td className="sp-cell sp-cell--total-label">合计</td>
              <td className="sp-cell" />
              <td className="sp-cell" />
              <td className="sp-cell" />
              <Ed suffix="s4-total-count" className="sp-cell sp-cell--total-num" />
              <td className="sp-cell" />
              <td className="sp-cell" />
              <Ro suffix="s4-total-hours" className="sp-cell sp-cell--total-num sp-cell--computed" />
              <td className="sp-cell" />
              <td className="sp-cell" />
              <td className="sp-cell" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
