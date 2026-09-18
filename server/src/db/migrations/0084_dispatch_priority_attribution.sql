-- 出仓派签达成分析：出仓准点 × 次日派签 的交叉计数，用于把未达成拆成「出仓晚」与「派送慢」两段
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "exit_met_next_day_sign_met" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "priority_before11_met" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "priority_exit_met_next_day_sign_met" integer DEFAULT 0 NOT NULL;
