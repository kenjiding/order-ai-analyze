-- 工单推送改为一个账号可有多条配置，不再限制每账号唯一一条
DROP INDEX IF EXISTS "work_order_push_schedules_user_id_unique";
--> statement-breakpoint
ALTER TABLE "work_order_push_schedules" ADD COLUMN IF NOT EXISTS "push_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
DELETE FROM "supplier_config_scope_bindings" WHERE "scope_key" = 'work-order-push.scheduled';
