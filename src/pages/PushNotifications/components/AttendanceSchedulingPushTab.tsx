import { Button, Empty, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table/interface'
import { Plus } from 'lucide-react'
import type { FeishuPushEntryWithKind } from '../feishuPushTypes'
import { AttendanceSchedulingPushPanel } from './AttendanceSchedulingPushPanel'
import './attendanceSchedulingPushTab.css'

type Props = {
  entries: FeishuPushEntryWithKind[]
  webhookColumns: ColumnsType<FeishuPushEntryWithKind>
  onOpenCreate: () => void
}

export function AttendanceSchedulingPushTab({ entries, webhookColumns, onOpenCreate }: Props) {
  return (
    <div className="attendance-scheduling-push-tab-page space-y-5">
      <div className="as-card">
        <div className="as-card-head">
          <div>
            <div className="as-card-head-title">排班计划推送</div>
            <Typography.Text type="secondary" className="mt-1 block text-xs leading-relaxed">
              填写排班计划并截图推送到飞书群；除固定备注外，其余数值默认为空，由人工填写。
            </Typography.Text>
          </div>
        </div>
        <div className="as-card-body">
          <AttendanceSchedulingPushPanel />
        </div>
      </div>

      <div className="as-card">
        <div className="as-card-head">
          <div>
            <div className="as-card-head-title">推送配置</div>
            <Typography.Text type="secondary" className="mt-1 block text-xs leading-relaxed">
              管理出勤及排班计划推送 webhook；推送类型固定为本页签，无需单独选择。
            </Typography.Text>
          </div>
          <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={onOpenCreate}>
            添加推送
          </Button>
        </div>
        <div className="as-card-body !pt-3">
          <Table<FeishuPushEntryWithKind>
            rowKey="id"
            columns={webhookColumns}
            dataSource={entries}
            pagination={false}
            locale={{
              emptyText: <Empty className="py-12" description="暂无推送条目，点击右上角「添加推送」开始配置。" />,
            }}
            scroll={{ x: 990 }}
          />
        </div>
      </div>
    </div>
  )
}
