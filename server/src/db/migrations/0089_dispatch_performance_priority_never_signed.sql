-- 异常报备剔除优先件分母时，需要知道 never_signed_waybill_nos 里哪些是优先件
ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "priority_never_signed_waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL;
