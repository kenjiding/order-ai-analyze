-- 区域包裹价格 ↔ iMile 路由码对应关系：一个 postcode+suburb 常年被拆成多个路由码（密度高的大区
-- 按车/按片再切分），是一对多，不能塞进 region_package_prices 的单值列，单独建子表记录。
-- 数据由「对齐路由码」按钮维护：拉一段时间窗口的到件记录，与本表做全量 diff——
-- 窗口内查到的组合 upsert，查不到的删除（route_code 会随派件区域调整失效/换绑）。
CREATE TABLE IF NOT EXISTS "region_package_price_route_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "region_code" varchar(16) NOT NULL,
  "postcode" varchar(16) NOT NULL,
  "suburb" varchar(128) NOT NULL,
  "route_code" varchar(32) NOT NULL,
  "synced_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "region_package_price_route_codes_unique"
  ON "region_package_price_route_codes" ("region_code", "postcode", "suburb", "route_code");
