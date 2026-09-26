-- 「这天算不算开仓分拣」的到件量阈值，按站点覆盖全局 MIN_SORTING_WAYBILLS（见 imile/sortingWorkday.ts）。
-- 为空 = 沿用全局默认。全局阈值是照大站点定的固定值，体量小的站点正常营业日到件量可能
-- 常年低于它，被误判成「没开仓」而永久漏统计（结算不回补）。
ALTER TABLE "dispatch_performance_configs" ADD COLUMN IF NOT EXISTS "min_sorting_waybills" integer;
