-- 流转记录去掉转出方凭证图片（接收方的申报证据 receiver_report_image_url 保留），
-- 改为记录业务发生日期：补录历史流转时，实际发生的那天与录入那天不是一回事。
-- 存量行按录入日期回填。
ALTER TABLE "container_transfers" DROP COLUMN IF EXISTS "image_url";
--> statement-breakpoint
ALTER TABLE "container_transfers"
  ADD COLUMN IF NOT EXISTS "occurred_at" date NOT NULL DEFAULT CURRENT_DATE;
--> statement-breakpoint
UPDATE "container_transfers" SET "occurred_at" = "created_at"::date;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfers_occurred_at_idx" ON "container_transfers" ("occurred_at");
