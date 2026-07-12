-- 0036 已落地后补齐站点日运单缓存字段（供 24H 增量判定与路由白名单）
ALTER TABLE "driver_map_waybill_points" ADD COLUMN IF NOT EXISTS "consignee_route_code" varchar(64) DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "driver_map_waybill_points" ADD COLUMN IF NOT EXISTS "last_scan_site_code" varchar(64) DEFAULT '' NOT NULL;
