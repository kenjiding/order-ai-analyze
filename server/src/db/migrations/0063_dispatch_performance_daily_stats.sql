-- 出仓派签达成分析：日度指标表。
-- 以「到件日 arrival_date」为批次，在「11点前出仓」与「24小时派签」两个指标都定终值后一次性结算落库。
-- 只存最细粒度格子（供应商单位 × 路由码 × 司机），路由码层/供应商层由查询 SUM 得到，不重复存储。
-- 四象限 exit_*_sign_* 之和恒等于 total：
--   24H 派签达标 = exit_met_sign_met + exit_unmet_sign_met
--   11点前出仓达标 = exit_met_sign_met + exit_met_sign_unmet
-- route_code / courier_code 用空串表示「无路由码」「未派件（无司机）」，保证司机行加总 = 供应商总数。

CREATE TABLE IF NOT EXISTS "dispatch_performance_daily_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrival_date" varchar(10) NOT NULL,
	"station_code" varchar(64) NOT NULL,
	"supplier_key" varchar(512) NOT NULL,
	"vendor_code" varchar(64) DEFAULT '' NOT NULL,
	"supplier_name" varchar(255) DEFAULT '' NOT NULL,
	"route_code" varchar(128) DEFAULT '' NOT NULL,
	"courier_code" varchar(64) DEFAULT '' NOT NULL,
	"courier_name" varchar(255) DEFAULT '' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"exit_met_sign_met" integer DEFAULT 0 NOT NULL,
	"exit_met_sign_unmet" integer DEFAULT 0 NOT NULL,
	"exit_unmet_sign_met" integer DEFAULT 0 NOT NULL,
	"exit_unmet_sign_unmet" integer DEFAULT 0 NOT NULL,
	"problem_count" integer DEFAULT 0 NOT NULL,
	"never_signed_count" integer DEFAULT 0 NOT NULL,
	"late_signed_count" integer DEFAULT 0 NOT NULL,
	"never_signed_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"late_signed_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problem_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"before11_unmet_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_performance_daily_stats_cell_unique" ON "dispatch_performance_daily_stats" USING btree ("arrival_date","station_code","supplier_key","route_code","courier_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_performance_daily_stats_station_date_idx" ON "dispatch_performance_daily_stats" USING btree ("arrival_date","station_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_performance_daily_stats_supplier_idx" ON "dispatch_performance_daily_stats" USING btree ("supplier_key","arrival_date");
