-- 供应商区域地图路由难易度：商业街/公寓密度信号缓存（数据源 OSM Overpass，按邮编+郊区缓存）
CREATE TABLE IF NOT EXISTS "vendor_region_area_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zip_code" varchar(16) NOT NULL,
	"suburb" varchar(128) NOT NULL,
	"commercial_count" integer DEFAULT 0 NOT NULL,
	"building_count" integer DEFAULT 0 NOT NULL,
	"apartment_count" integer DEFAULT 0 NOT NULL,
	"bbox_area_km2" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_region_area_signals_zip_suburb_unique" ON "vendor_region_area_signals" USING btree ("zip_code","suburb");
