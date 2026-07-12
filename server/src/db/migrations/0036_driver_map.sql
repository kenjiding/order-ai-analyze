-- 司机地图：运单地图点缓存 + 地址地理编码缓存 + 车队供应商配置补充站点编码
-- 司机无实时GPS，用「最近一单已完成/问题件」的收件地址坐标近似代表位置。
-- 供应商归属站点、启用状态均复用已有的 fleet_supplier_push_configs / supplier_config_scope_bindings，
-- 不再单独维护一份供应商配置。

ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "station_code" varchar(64) DEFAULT '' NOT NULL;
--> statement-breakpoint
DROP TABLE IF EXISTS "driver_map_vendor_configs";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_map_waybill_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waybill_no" varchar(64) NOT NULL,
	"station_code" varchar(64) NOT NULL,
	"vendor_code" varchar(64) DEFAULT '' NOT NULL,
	"courier_code" varchar(64) DEFAULT '' NOT NULL,
	"courier_name" varchar(255) DEFAULT '' NOT NULL,
	"data_date" varchar(10) NOT NULL,
	"delivery_time" varchar(32),
	"sign_date" varchar(32),
	"last_problem_date" varchar(32),
	"consignee_route_code" varchar(64) DEFAULT '' NOT NULL,
	"last_scan_site_code" varchar(64) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"address_text" varchar(1024) DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"geocoded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "driver_map_waybill_points_waybill_date_unique" ON "driver_map_waybill_points" USING btree ("waybill_no","data_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_map_waybill_points_station_date_idx" ON "driver_map_waybill_points" USING btree ("station_code","data_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_map_waybill_points_status_idx" ON "driver_map_waybill_points" USING btree ("data_date","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "driver_map_waybill_points_courier_idx" ON "driver_map_waybill_points" USING btree ("data_date","courier_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geocode_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address_text" varchar(1024) NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"status" varchar(16) DEFAULT 'ok' NOT NULL,
	"provider" varchar(32) DEFAULT 'google' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "geocode_cache_address_text_unique" ON "geocode_cache" USING btree ("address_text");
