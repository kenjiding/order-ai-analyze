import { Button, Empty, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table/interface'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FeishuPushEntryWithKind } from '../feishuPushTypes'
import { AttendanceSchedulingPushPanel } from './AttendanceSchedulingPushPanel'
import './attendanceSchedulingPushTab.css'

type Props = {
  entries: FeishuPushEntryWithKind[]
  webhookColumns: ColumnsType<FeishuPushEntryWithKind>
  onOpenCreate: () => void
}

export function AttendanceSchedulingPushTab({ entries, webhookColumns, onOpenCreate }: Props) {
  const { t } = useTranslation('pushNotifications')

  return (
    <div className="attendance-scheduling-push-tab-page space-y-5">
      <div className="as-card">
        <div className="as-card-head">
          <div>
            <div className="as-card-head-title">{t('attendanceTab.planTitle')}</div>
            <Typography.Text type="secondary" className="mt-1 block text-xs leading-relaxed">
              {t('attendanceTab.planDesc')}
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
            <div className="as-card-head-title">{t('attendanceTab.configTitle')}</div>
            <Typography.Text type="secondary" className="mt-1 block text-xs leading-relaxed">
              {t('attendanceTab.configDesc')}
            </Typography.Text>
          </div>
          <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={onOpenCreate}>
            {t('addPush')}
          </Button>
        </div>
        <div className="as-card-body !pt-3">
          <Table<FeishuPushEntryWithKind>
            rowKey="id"
            columns={webhookColumns}
            dataSource={entries}
            pagination={false}
            locale={{
              emptyText: <Empty className="py-12" description={t('table.empty')} />,
            }}
            scroll={{ x: 990 }}
          />
        </div>
      </div>
    </div>
  )
}
