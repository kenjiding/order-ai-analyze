-- 24小时派签告警：定时推送配置表（每个账号最多一条，userId 唯一）
-- 从「供应商数据分析」的 24H 派签率指标封装复用出来的独立告警，配置形状与「11点前出仓告警」一致，
-- 额外增加 alert_threshold_pct（预警阈值）。复用出仓告警等业务的供应商配置 catalog。

CREATE TABLE IF NOT EXISTS "dispatch_alarm_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"push_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"station_code" varchar(64) DEFAULT '' NOT NULL,
	"alert_threshold_pct" integer DEFAULT 92 NOT NULL,
	"imile_token" varchar(2048),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_alarm_schedules" ADD CONSTRAINT "dispatch_alarm_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dispatch_alarm_schedules" ADD CONSTRAINT "dispatch_alarm_schedules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_alarm_schedules_user_id_unique" ON "dispatch_alarm_schedules" USING btree ("user_id");
