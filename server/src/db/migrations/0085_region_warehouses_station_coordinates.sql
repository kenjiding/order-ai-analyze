-- 大区主仓地址（按 regionCode，一个州一条）+ 站点坐标（按 stationCode，运营从站点选择器里选站点后手动录入地址/经纬度）
-- 供供应商区域地图「路由难易程度」算距离用：先查路由的 deliveryStation 对应站点坐标，没配就退到所属大区主仓坐标
CREATE TABLE IF NOT EXISTS "region_warehouses" (
  "region_code" varchar(16) PRIMARY KEY,
  "name" varchar(128) NOT NULL,
  "address" varchar(512) NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "station_coordinates" (
  "station_code" varchar(32) PRIMARY KEY,
  "station_name" varchar(128) NOT NULL,
  "address" varchar(512) NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "station_coordinates_name_unique"
  ON "station_coordinates" ("station_name");
