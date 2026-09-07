import { forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { buildFleetPivotOutlineModel } from '../fleetPivotOutline'
import type { FleetRouteBucket } from '../fleetSupplierPushTypes'
import './fleetPivotReportView.css'

export type FleetPivotReportViewProps = {
  title: string
  subtitle?: string
  /** 透视说明文案；截图默认展示，页面内预览可关 */
  showNote?: boolean
  buckets: FleetRouteBucket[]
}

/** 根节点带 .fleet-pivot-report-view，供 dom 查询与 html-to-image 截图 */
export const FleetPivotReportView = forwardRef<HTMLDivElement, FleetPivotReportViewProps>(
  function FleetPivotReportView({ title, subtitle, buckets, showNote: _showNote = true }, ref) {
    const { t } = useTranslation('pushNotifications')
    // 截图固定英文，不跟随界面语言（供应商侧只看英文表格）
    const tEn = (key: string): string => t(key, { lng: 'en' })
    const { bodyRows, grandTotal } = useMemo(() => buildFleetPivotOutlineModel(buckets), [buckets])

    if (!buckets.length) {
      return (
        <div ref={ref} className="fleet-pivot-report-view">
          <div className="fpr-head">
            <div className="fpr-title-block">
              <div className="fpr-title">{title}</div>
              {subtitle ? <div className="fpr-subtitle">{subtitle}</div> : null}
            </div>
          </div>
          <div className="fpr-empty">{tEn('fleetReport.noData')}</div>
        </div>
      )
    }

    return (
      <div ref={ref} className="fleet-pivot-report-view">
        <div className="fpr-head">
          <div className="fpr-title-block">
            <div className="fpr-title">{title}</div>
            {subtitle ? <div className="fpr-subtitle">{subtitle}</div> : null}
          </div>
          <div className="fpr-total-panel">
            <div className="fpr-total-label">{tEn('fleetReport.grandTotalLabel')}</div>
            <div className="fpr-total-value">{String(grandTotal)}</div>
          </div>
        </div>

        <table className="fpr-table">
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '32%' }} />
            <col style={{ width: '28%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>{tEn('fleetReport.routeCode')}</th>
              <th>{tEn('fleetReport.postcode')}</th>
              <th>{tEn('fleetReport.city')}</th>
              <th className="fpr-th-num">{tEn('fleetReport.countColumn')}</th>
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row) => (
              <tr key={row.key} className={`fpr-tr fpr-tr--${row.kind}`}>
                <td>{row.c0}</td>
                <td>{row.c1}</td>
                <td>{row.c2}</td>
                <td className="fpr-td-num">{row.c3}</td>
              </tr>
            ))}
            <tr className="fpr-tr--footer">
              <td colSpan={3}>{tEn('fleetReport.total')}</td>
              <td className="fpr-td-num">{String(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  },
)
