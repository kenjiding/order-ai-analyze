-- 异常报备剔除次日派签率分母时，次日截止时间（出仓日23:59:59）跟24H滚动窗口不是同一个口径，
-- 同一运单号在两个口径下达标与否可能不一致，必须单独存一份「次日未达标运单号」才能算对。
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "next_day_unmet_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "priority_next_day_unmet_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL;
