-- 出仓派签达成分析改为「两趟结算」：两个指标定终值的时间不同，不能等到同一刻一起算。
--   11点前出仓率：到件日 D → D+1 的 11:00 出仓阈值一过即定终值，当天就能结算
--   24小时派签率：到件日 D → D+1 出仓 → D+2 的 11:00 窗口才到期。
--     提前算会被归班盘点重新派出，数据会乱，所以必须等窗口到期。
-- 同一个到件日 D 因此先后被写两次：D+1 写出仓，D+2 补派签并填四象限。

-- before11_met 单独存：出仓那一趟就已确定，此时四象限还填不出来（派签未知），无法从象限反推。
ALTER TABLE "dispatch_performance_daily_stats"
  ADD COLUMN IF NOT EXISTS "before11_met" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- 派签是否已结算：false 时四象限与派签相关列全为 0，页面必须显示「结算中」而不是 0%
ALTER TABLE "dispatch_performance_daily_stats"
  ADD COLUMN IF NOT EXISTS "dispatch_settled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 结算台账：记「这个批次跑过没」，与「跑出来有没有数据」分开。
-- 不分拣的工作日 inbound/query 本就没数据、聚合出 0 个格子，若只看日度表有没有行判重，
-- 这天会被每天重新拉一遍直到滑出回看窗口。
CREATE TABLE IF NOT EXISTS "dispatch_performance_settled_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_code" varchar(64) NOT NULL,
	"arrival_date" varchar(10) NOT NULL,
	"exit_settled_at" timestamp with time zone,
	"dispatch_settled_at" timestamp with time zone,
	"waybill_count" integer DEFAULT 0 NOT NULL,
	"cell_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_performance_settled_batches_unique" ON "dispatch_performance_settled_batches" USING btree ("station_code","arrival_date");
