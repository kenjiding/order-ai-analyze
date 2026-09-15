-- 出仓派签达成分析：当天出仓 / 次日派签 / 优先件次日完成 的格子级计数
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "same_day_exit_met" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "next_day_sign_met" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "priority_total" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "priority_next_day_sign_met" integer DEFAULT 0 NOT NULL;
