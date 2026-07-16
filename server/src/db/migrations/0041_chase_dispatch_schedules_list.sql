-- 催派推送改为一个账号可有多条配置（按站点区分），不再限制每账号唯一一条
DROP INDEX IF EXISTS "chase_dispatch_schedules_user_id_unique";
--> statement-breakpoint
ALTER TABLE "chase_dispatch_schedules" ADD COLUMN IF NOT EXISTS "push_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
