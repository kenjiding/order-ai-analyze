import { forwardRef, useMemo } from 'react'
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
          <div className="fpr-empty">（无匹配路由数据）</div>
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
            <div className="fpr-total-label">总运单量</div>
            <div className="fpr-total-value">{String(grandTotal)}</div>
          </div>
        </div>

        <table className="fpr-table">
          <colgroup>
            <col style={{ width: '18%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '46%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>路由编码</th>
              <th>邮政编码</th>
              <th>城市</th>
              <th className="fpr-th-num">计数项: 运单号</th>
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
              <td colSpan={3}>合计</td>
              <td className="fpr-td-num">{String(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  },
)
