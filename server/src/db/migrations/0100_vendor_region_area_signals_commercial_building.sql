-- 路由难易度新增「写字楼/商铺/工业建筑占比」信号，补一列计数（分母沿用已有的 building_count）
ALTER TABLE "vendor_region_area_signals" ADD COLUMN IF NOT EXISTS "commercial_building_count" integer DEFAULT 0 NOT NULL;
