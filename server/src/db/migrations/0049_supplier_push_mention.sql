-- 供应商配置新增「@ 外部联系人」花名册；4 类定时推送各加「是否 @ 相关人员」开关
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "mention_open_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "mention_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "chase_dispatch_schedules" ADD COLUMN IF NOT EXISTS "mention_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "work_order_push_schedules" ADD COLUMN IF NOT EXISTS "mention_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "mention_enabled" boolean DEFAULT false NOT NULL;
