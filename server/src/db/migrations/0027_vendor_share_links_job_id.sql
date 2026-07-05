-- 供应商日报 + 分享链接改为按任务（job_id）绑定，替代原来的按 report_date：
-- 每条分析任务独立一份对外日报与分享链接，互不覆盖；保留一周（按 created_at 清理）。
-- 开发阶段旧数据可弃，直接清空重建。

TRUNCATE TABLE "vendor_share_links";
--> statement-breakpoint
TRUNCATE TABLE "vendor_daily_reports";
--> statement-breakpoint
-- vendor_daily_reports：改按 job_id 唯一
DROP INDEX IF EXISTS "vendor_daily_reports_report_date_unique";
--> statement-breakpoint
ALTER TABLE "vendor_daily_reports" ADD COLUMN "job_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendor_daily_reports" ADD CONSTRAINT "vendor_daily_reports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_daily_reports_job_id_unique" ON "vendor_daily_reports" USING btree ("job_id");
--> statement-breakpoint
-- vendor_share_links：改按 (vendor_code, job_id) 唯一
DROP INDEX IF EXISTS "vendor_share_links_vendor_date_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "vendor_share_links_report_date_idx";
--> statement-breakpoint
ALTER TABLE "vendor_share_links" ADD COLUMN "job_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "vendor_share_links" ADD CONSTRAINT "vendor_share_links_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_share_links_vendor_job_unique" ON "vendor_share_links" USING btree ("vendor_code","job_id");
--> statement-breakpoint
CREATE INDEX "vendor_share_links_job_id_idx" ON "vendor_share_links" USING btree ("job_id");
