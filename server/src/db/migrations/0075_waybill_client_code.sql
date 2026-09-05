-- 24H派签/滞留告警要统计「本地件优先客户」包裹数：站点日运单缓存表补商家编码
ALTER TABLE "driver_map_waybill_points" ADD COLUMN IF NOT EXISTS "client_code" varchar(64) NOT NULL DEFAULT '';
