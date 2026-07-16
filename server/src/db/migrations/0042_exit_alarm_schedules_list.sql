-- 出仓告警改为一个账号可有多条配置（按站点区分），不再限制每账号唯一一条
DROP INDEX IF EXISTS "exit_alarm_schedules_user_id_unique";
--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "push_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
