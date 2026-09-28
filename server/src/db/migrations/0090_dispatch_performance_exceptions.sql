-- 派签异常报备：司机事故/车坏等不可抗力，某天某供应商×路由码×司机下这些运单号确实送不了，
-- 从派送类指标（24H 派签率/次日派签率/优先件次日完成率）分子分母剔除；出仓率不受影响。
-- 用自然键关联 dispatch_performance_daily_stats 的格子，不做外键——那张表每次结算是先删后插整表覆盖。
CREATE TABLE IF NOT EXISTS "dispatch_performance_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "station_code" varchar(64) NOT NULL,
  "arrival_date" varchar(10) NOT NULL,
  "supplier_key" varchar(512) NOT NULL,
  "route_code" varchar(128) DEFAULT '' NOT NULL,
  "courier_code" varchar(64) DEFAULT '' NOT NULL,
  "waybill_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "reason" varchar(1000) DEFAULT '' NOT NULL,
  "reported_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reported_by_name" varchar(255) DEFAULT '' NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispatch_performance_exceptions_cell_idx"
  ON "dispatch_performance_exceptions" ("station_code", "arrival_date", "supplier_key", "route_code", "courier_code");
