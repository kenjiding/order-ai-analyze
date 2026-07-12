-- 司机地图：问题件原因（searchWaybill.problemReason）
ALTER TABLE "driver_map_waybill_points" ADD COLUMN IF NOT EXISTS "problem_reason" varchar(512) DEFAULT '' NOT NULL;
