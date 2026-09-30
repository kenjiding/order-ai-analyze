-- AI异常订单分析埋点：每个用户一行累计计数（分析订单量/点击量/导出量/新增异常完结量），不记流水。
CREATE TABLE IF NOT EXISTS "order_exception_usage_stats" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "analyzed_order_count" integer DEFAULT 0 NOT NULL,
  "order_click_count" integer DEFAULT 0 NOT NULL,
  "export_count" integer DEFAULT 0 NOT NULL,
  "closure_add_count" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
