-- 工单推送新增「推送星期」筛选，逻辑与催派推送/派签告警保持一致
ALTER TABLE "work_order_push_schedules" ADD COLUMN IF NOT EXISTS "weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
-- 该字段引入前工单推送不做星期筛选（相当于每天检查），回填已有记录为全 7 天，避免存量配置静默停止推送
UPDATE "work_order_push_schedules" SET "weekdays" = '[1,2,3,4,5,6,7]'::jsonb WHERE "weekdays" = '[]'::jsonb;
