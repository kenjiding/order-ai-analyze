import type { AttendanceSchedulingPlanPreview } from '../attendanceSchedulingPlanPreviewModel'
import {
  getSchedulingPlanHoursStructure,
  getSchedulingPlanProcesses,
} from '../attendanceSchedulingPlanPreviewModel'
import { useTranslation } from 'react-i18next'
import '../attendanceSchedulingPlanPreview.css'

type Props = {
  preview: AttendanceSchedulingPlanPreview
  cellTexts: Record<string, string>
  onCellChange: (key: string, text: string) => void
}

export default function AttendanceSchedulingPlanPreviewView({ preview, cellTexts, onCellChange }: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const { planDate } = preview
  const schedulingProcesses = getSchedulingPlanProcesses()
  const hoursStructure = getSchedulingPlanHoursStructure()
  const k = (suffix: string) => `${planDate}:${suffix}`
  const v = (suffix: string) => cellTexts[k(suffix)] ?? ''

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

      <div className="sp-section">
        <div className="sp-section-hd sp-section-hd--s1">{t('scheduling.section1')}</div>
        <table className="sp-table">
          <thead>
            <tr>
              <th>{t('scheduling.columns.inboundVolume')}</th>
              <th>{t('scheduling.columns.coarseVolume')}</th>
              <th>{t('scheduling.columns.fineVolume')}</th>
              <th>{t('scheduling.columns.totalHours')}</th>
              <th>{t('scheduling.columns.totalHeadcount')}</th>
              <th>{t('scheduling.columns.totalEfficiency')}</th>
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

      <div className="sp-section">
        <div className="sp-section-hd sp-section-hd--s2">{t('scheduling.section2')}</div>
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
              <th>{t('scheduling.columns.process')}</th>
              <th>{t('scheduling.columns.prevDayQty')}</th>
              <th>{t('scheduling.columns.prevDayHours')}</th>
              <th>{t('scheduling.columns.actualEff')}</th>
              <th>{t('scheduling.columns.targetEff')}</th>
              <th>{t('scheduling.columns.achievementRate')}</th>
              <th>{t('scheduling.columns.gap')}</th>
              <th>{t('scheduling.columns.verdict')}</th>
              <th>{t('scheduling.columns.reason')}</th>
              <th>{t('scheduling.columns.nextDaySuggest')}</th>
              <th>{t('scheduling.columns.adjustSlot')}</th>
            </tr>
          </thead>
          <tbody>
            {schedulingProcesses.map((proc, idx) => (
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

      <div className="sp-row-3">
        <div className="sp-section sp-section--3a">
          <div className="sp-section-hd sp-section-hd--s3a">{t('scheduling.section3a')}</div>
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
                <th>{t('scheduling.columns.hourType')}</th>
                <th>{t('scheduling.columns.hourTypeDesc')}</th>
                <th>{t('scheduling.columns.plannedHours')}</th>
                <th>{t('scheduling.columns.ratio')}</th>
                <th>{t('scheduling.columns.dataSource')}</th>
                <th>{t('scheduling.columns.note')}</th>
              </tr>
            </thead>
            <tbody>
              {hoursStructure.map(({ type, label, desc, source }) => {
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

        <div className="sp-section sp-section--3b">
          <div className="sp-section-hd sp-section-hd--s3b">{t('scheduling.section3b')}</div>
          <table className="sp-table">
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('scheduling.columns.process')}</th>
                <th>{t('scheduling.columns.plannedHours')}</th>
                <th>{t('scheduling.columns.hourRatio')}</th>
                <th>{t('scheduling.columns.requiredHeadcount')}</th>
              </tr>
            </thead>
            <tbody>
              {schedulingProcesses.map((proc, idx) => (
                <tr key={proc.id}>
                  <td className="sp-cell sp-cell--label">{proc.label}</td>
                  <Ro suffix={`s3b-${idx}-hours`} className="sp-cell sp-cell--num sp-cell--computed" />
                  <Ro suffix={`s3b-${idx}-ratio`} className="sp-cell sp-cell--rate sp-cell--computed" />
                  <Ro suffix={`s3b-${idx}-count`} className="sp-cell sp-cell--num sp-cell--computed" />
                </tr>
              ))}
              <tr className="sp-row--total">
                <td className="sp-cell sp-cell--total-label">{t('scheduling.total')}</td>
                <Ro suffix="s3b-total-hours" className="sp-cell sp-cell--total-num sp-cell--computed" />
                <Ro suffix="s3b-total-ratio" className="sp-cell sp-cell--total-num sp-cell--computed" />
                <Ro suffix="s3b-total-count" className="sp-cell sp-cell--total-num sp-cell--computed" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="sp-section">
        <div className="sp-section-hd sp-section-hd--s4">{t('scheduling.section4')}</div>
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
              <th>{t('scheduling.columns.process')}</th>
              <th>{t('scheduling.columns.position')}</th>
              <th>{t('scheduling.columns.plannedQty')}</th>
              <th>{t('scheduling.columns.positionEff')}</th>
              <th>{t('scheduling.columns.requiredAttendance')}</th>
              <th>{t('scheduling.columns.plannedStart')}</th>
              <th>{t('scheduling.columns.plannedEnd')}</th>
              <th>{t('scheduling.columns.plannedWorkHours')}</th>
              <th>{t('scheduling.columns.hourShare')}</th>
              <th>{t('scheduling.columns.note')}</th>
              <th>{t('scheduling.columns.dataBasis')}</th>
            </tr>
          </thead>
          <tbody>
            {schedulingProcesses.map((proc, idx) => (
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
              <td className="sp-cell sp-cell--total-label">{t('scheduling.total')}</td>
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
