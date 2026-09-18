-- 出仓派签达成分析的利润统计：
-- 运单表补 postcode/suburb（iMile 的 consigneeZipCode / consigneeCity），供匹配 region_package_prices；
-- 格子表补两个金额与两个计数，金额只在派签趟（dispatch_settled）算，出仓趟恒为 0。
ALTER TABLE "driver_map_waybill_points"
  ADD COLUMN IF NOT EXISTS "postcode" varchar(16) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "suburb" varchar(128) NOT NULL DEFAULT '';

ALTER TABLE "dispatch_performance_daily_stats"
  ADD COLUMN IF NOT EXISTS "vendor_profit" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "courier_profit" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "priced_signed_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unpriced_signed_count" integer NOT NULL DEFAULT 0;
