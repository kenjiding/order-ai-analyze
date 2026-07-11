-- 工单推送：推送时间从单值 push_time 改为多值列表 push_times（与催派推送/出仓告警一致的 [{id,time}] jsonb 结构）
-- 开发阶段直接切换字段，不做旧数据迁移适配。

ALTER TABLE "work_order_push_schedules" ADD COLUMN "push_times" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_order_push_schedules" DROP COLUMN "push_time";
