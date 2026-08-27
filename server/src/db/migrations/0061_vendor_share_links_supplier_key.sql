-- 供应商分享链接按「供应商单位」而不是供应商编码建立。
-- ADL-City 和 ADL-Lu 共用 vendor_code，原唯一索引 (vendor_code, job_id) 会让第二家
-- 在自动开通时被 onConflictDoNothing 静默跳过，推送时取到第一家的 token，
-- 供应商点开链接看到的是另一家的数据。
-- 存量行按 vendor_code::vendor_name 回填（与 buildSupplierUnitKey 同构）；
-- 回填后若同一 job 下仍有重复，说明本来就是同一家的重复行，由唯一索引兜住。
ALTER TABLE "vendor_share_links"
  ADD COLUMN IF NOT EXISTS "supplier_key" varchar(320) NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE "vendor_share_links"
  SET "supplier_key" = "vendor_code" || '::' || "vendor_name"
  WHERE "supplier_key" = '';
--> statement-breakpoint
DROP INDEX IF EXISTS "vendor_share_links_vendor_job_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_share_links_unit_job_unique"
  ON "vendor_share_links" ("supplier_key", "job_id");
