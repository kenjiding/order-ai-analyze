-- 车队供应商推送配置按州/区域隔离：新增 region_code 列。
-- 历史数据（原全局共用）统一归入 'global'：不属于任何一个州，全部州可见且可编辑/删除；
-- 新建的配置固定落到创建者所属州的 regionCode，同州账号共用一份。
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "region_code" varchar(16) NOT NULL DEFAULT 'global';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fleet_supplier_push_configs_region_idx" ON "fleet_supplier_push_configs" ("region_code");
