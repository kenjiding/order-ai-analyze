-- 流转记录主键由 varchar 业务号（TR00000001）改为自增数字。
-- 原设计把「数据库主键」和「跨方引用标识」混在一个字段：补零 8 位过宽、
-- 前缀搜索输数字搜不到、超过 8 位后字典序断裂。
-- 现在主键回归数字，对外展示的 TR-000123 由前端格式化，搜索按数字匹配。

ALTER TABLE "container_transfer_items" DROP CONSTRAINT IF EXISTS "container_transfer_items_transfer_id_container_transfers_id_fk";
--> statement-breakpoint
ALTER TABLE "container_balance_audits" DROP CONSTRAINT IF EXISTS "container_balance_audits_transfer_id_container_transfers_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" DROP CONSTRAINT IF EXISTS "container_transfer_messages_transfer_id_container_transfers_id_";
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" DROP CONSTRAINT IF EXISTS "container_transfer_changes_transfer_id_container_transfers_id_f";
--> statement-breakpoint

-- 开发阶段无业务数据；若有历史行，去掉 TR 前缀与补零后取数字部分
ALTER TABLE "container_transfers" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "container_transfers" ALTER COLUMN "id" TYPE bigint USING NULLIF(regexp_replace("id", '\D', '', 'g'), '')::bigint;
--> statement-breakpoint
ALTER TABLE "container_transfer_items" ALTER COLUMN "transfer_id" TYPE bigint USING NULLIF(regexp_replace("transfer_id", '\D', '', 'g'), '')::bigint;
--> statement-breakpoint
ALTER TABLE "container_balance_audits" ALTER COLUMN "transfer_id" TYPE bigint USING NULLIF(regexp_replace("transfer_id", '\D', '', 'g'), '')::bigint;
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" ALTER COLUMN "transfer_id" TYPE bigint USING NULLIF(regexp_replace("transfer_id", '\D', '', 'g'), '')::bigint;
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" ALTER COLUMN "transfer_id" TYPE bigint USING NULLIF(regexp_replace("transfer_id", '\D', '', 'g'), '')::bigint;
--> statement-breakpoint

-- 主键自增序列（与 drizzle bigserial 的形态一致）
DROP SEQUENCE IF EXISTS "container_transfer_id_seq";
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "container_transfers_id_seq" AS bigint START WITH 1 INCREMENT BY 1 OWNED BY "container_transfers"."id";
--> statement-breakpoint
ALTER TABLE "container_transfers" ALTER COLUMN "id" SET DEFAULT nextval('container_transfers_id_seq');
--> statement-breakpoint
SELECT setval('container_transfers_id_seq', COALESCE((SELECT MAX("id") FROM "container_transfers"), 0) + 1, false);
--> statement-breakpoint

ALTER TABLE "container_transfer_items" ADD CONSTRAINT "container_transfer_items_transfer_id_container_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "container_balance_audits" ADD CONSTRAINT "container_balance_audits_transfer_id_container_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" ADD CONSTRAINT "container_transfer_messages_transfer_id_container_transfers_id_" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" ADD CONSTRAINT "container_transfer_changes_transfer_id_container_transfers_id_f" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE set null;
