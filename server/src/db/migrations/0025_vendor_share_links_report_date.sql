-- 供应商日报分享链接改为按日期绑定：每个供应商每天一条链接，替代原来的"每供应商一条长期链接"。
-- vendor_daily_reports 同理改为一天一行（供发布时 upsert）。
-- vendor_share_links 目前只有测试数据（无真实供应商在用），直接清空重建。

-- 去重：同一 report_date 只保留最新一行，才能建唯一索引
DELETE FROM "vendor_daily_reports" a USING "vendor_daily_reports" b
WHERE a."report_date" = b."report_date" AND a."created_at" < b."created_at";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_daily_reports_report_date_unique" ON "vendor_daily_reports" USING btree ("report_date");
--> statement-breakpoint

TRUNCATE TABLE "vendor_share_links";
--> statement-breakpoint
DROP INDEX IF EXISTS "vendor_share_links_vendor_code_unique";
--> statement-breakpoint
ALTER TABLE "vendor_share_links" ADD COLUMN "report_date" varchar(10) NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_share_links_vendor_date_unique" ON "vendor_share_links" USING btree ("vendor_code","report_date");
--> statement-breakpoint
CREATE INDEX "vendor_share_links_report_date_idx" ON "vendor_share_links" USING btree ("report_date");
