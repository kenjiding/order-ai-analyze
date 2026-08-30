-- 出仓派签达成分析：站点配置表。
-- 一个站点一条配置，确认后即开启该站点的每日两趟结算（出仓 D+1、派签 D+2）。
--
-- 为什么按站点全局唯一、而不是像派签告警那样每账号一份：
-- 结算是系统级任务、产出的是共享数据，两个账号都配同一站点会重复结算、重复打 iMile。
-- region_code / created_by 只用于列表可见性与审计，不参与结算调度。
--
-- 统计范围不在这里配：该站点下 fleet_supplier_push_configs 里的全部供应商自动纳入。
-- 若在配置期漏选供应商，其历史数据将永久缺失（结算不提供手动重算），
-- 因此供应商筛选放在详情页 UI 层做，可逆、不影响落库。

CREATE TABLE IF NOT EXISTS "dispatch_performance_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_code" varchar(64) NOT NULL,
	"station_name" varchar(255) DEFAULT '' NOT NULL,
	"region_code" varchar(32) DEFAULT '' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatch_performance_configs" ADD CONSTRAINT "dispatch_performance_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_configs" ADD CONSTRAINT "dispatch_performance_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_performance_configs_station_unique" ON "dispatch_performance_configs" USING btree ("station_code");
