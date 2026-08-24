-- 容器管理：主体账户 / 容器台账 / 流转记录
-- 数量的唯一真相源是 container_transfer_items（逐品类的 申报/实收/落表 三个数量），
-- 流转主表不再冗余存总量与首个品类，避免多品类统计出错。
-- 数据可见范围由 container_account_users 绑定决定，不做州级隔离。

CREATE TABLE IF NOT EXISTS "container_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container_accounts" DROP CONSTRAINT IF EXISTS "container_accounts_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_accounts" ADD CONSTRAINT "container_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
-- 主体名称大小写不敏感唯一：同名主体在界面上完全无法区分
CREATE UNIQUE INDEX IF NOT EXISTS "container_accounts_name_unique" ON "container_accounts" (lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_accounts_kind_idx" ON "container_accounts" ("kind");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_account_users" (
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "container_account_users_pk" PRIMARY KEY("user_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "container_account_users" DROP CONSTRAINT IF EXISTS "container_account_users_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_account_users" ADD CONSTRAINT "container_account_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "container_account_users" DROP CONSTRAINT IF EXISTS "container_account_users_account_id_container_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "container_account_users" ADD CONSTRAINT "container_account_users_account_id_container_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "container_accounts"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_account_users_account_idx" ON "container_account_users" ("account_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"container_type" varchar(32) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- 并发扣减的最后一道兜底，应用层另有 SELECT ... FOR UPDATE
	CONSTRAINT "container_balances_quantity_non_negative" CHECK ("quantity" >= 0)
);
--> statement-breakpoint
-- 台账与审计是资产凭证，主体一旦有台账就不允许被删除（不做级联清除）
ALTER TABLE "container_balances" DROP CONSTRAINT IF EXISTS "container_balances_account_id_container_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "container_balances" ADD CONSTRAINT "container_balances_account_id_container_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "container_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "container_balances_account_type_unique" ON "container_balances" ("account_id","container_type");
--> statement-breakpoint

-- 流转业务 ID 序列（TR00000001）。必须建在迁移里，不能运行时 DDL
CREATE SEQUENCE IF NOT EXISTS "container_transfer_id_seq" START WITH 1 INCREMENT BY 1;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_transfers" (
	"id" varchar(24) PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"image_url" text,
	"note" text,
	"receiver_report_reason" text,
	"receiver_report_image_url" text,
	"response_note" text,
	"sender_accepted_at" timestamp with time zone,
	"sender_accepted_by" uuid,
	"responded_at" timestamp with time zone,
	"responded_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "container_transfers_from_to_distinct" CHECK ("from_account_id" <> "to_account_id")
);
--> statement-breakpoint
ALTER TABLE "container_transfers" DROP CONSTRAINT IF EXISTS "container_transfers_from_account_id_container_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfers" ADD CONSTRAINT "container_transfers_from_account_id_container_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "container_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "container_transfers" DROP CONSTRAINT IF EXISTS "container_transfers_to_account_id_container_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfers" ADD CONSTRAINT "container_transfers_to_account_id_container_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "container_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "container_transfers" DROP CONSTRAINT IF EXISTS "container_transfers_sender_accepted_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfers" ADD CONSTRAINT "container_transfers_sender_accepted_by_users_id_fk" FOREIGN KEY ("sender_accepted_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "container_transfers" DROP CONSTRAINT IF EXISTS "container_transfers_responded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfers" ADD CONSTRAINT "container_transfers_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "container_transfers" DROP CONSTRAINT IF EXISTS "container_transfers_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfers" ADD CONSTRAINT "container_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfers_created_at_idx" ON "container_transfers" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfers_from_account_idx" ON "container_transfers" ("from_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfers_to_account_idx" ON "container_transfers" ("to_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfers_status_idx" ON "container_transfers" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" varchar(24) NOT NULL,
	"container_type" varchar(32) NOT NULL,
	"declared_quantity" integer NOT NULL,
	"received_quantity" integer,
	"settled_quantity" integer,
	CONSTRAINT "container_transfer_items_declared_positive" CHECK ("declared_quantity" > 0),
	CONSTRAINT "container_transfer_items_received_range" CHECK ("received_quantity" IS NULL OR ("received_quantity" >= 0 AND "received_quantity" <= "declared_quantity")),
	CONSTRAINT "container_transfer_items_settled_range" CHECK ("settled_quantity" IS NULL OR ("settled_quantity" >= 0 AND "settled_quantity" <= "declared_quantity"))
);
--> statement-breakpoint
ALTER TABLE "container_transfer_items" DROP CONSTRAINT IF EXISTS "container_transfer_items_transfer_id_container_transfers_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfer_items" ADD CONSTRAINT "container_transfer_items_transfer_id_container_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "container_transfer_items_transfer_type_unique" ON "container_transfer_items" ("transfer_id","container_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfer_items_transfer_idx" ON "container_transfer_items" ("transfer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_balance_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(16) NOT NULL,
	"account_id" uuid NOT NULL,
	"container_type" varchar(32) NOT NULL,
	"prev_quantity" integer,
	"new_quantity" integer,
	"delta" integer,
	"reason_type" varchar(32) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"transfer_id" varchar(24),
	"actor_user_id" uuid,
	"actor_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container_balance_audits" DROP CONSTRAINT IF EXISTS "container_balance_audits_account_id_container_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "container_balance_audits" ADD CONSTRAINT "container_balance_audits_account_id_container_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "container_accounts"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "container_balance_audits" DROP CONSTRAINT IF EXISTS "container_balance_audits_transfer_id_container_transfers_id_fk";
--> statement-breakpoint
ALTER TABLE "container_balance_audits" ADD CONSTRAINT "container_balance_audits_transfer_id_container_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "container_balance_audits" DROP CONSTRAINT IF EXISTS "container_balance_audits_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_balance_audits" ADD CONSTRAINT "container_balance_audits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_balance_audits_account_created_idx" ON "container_balance_audits" ("account_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_balance_audits_created_at_idx" ON "container_balance_audits" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_balance_audits_transfer_idx" ON "container_balance_audits" ("transfer_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_transfer_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" varchar(24) NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"proposed_quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" DROP CONSTRAINT IF EXISTS "container_transfer_messages_transfer_id_container_transfers_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" ADD CONSTRAINT "container_transfer_messages_transfer_id_container_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" DROP CONSTRAINT IF EXISTS "container_transfer_messages_author_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfer_messages" ADD CONSTRAINT "container_transfer_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfer_messages_transfer_idx" ON "container_transfer_messages" ("transfer_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "container_transfer_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" varchar(24),
	"action" varchar(16) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"before_data" jsonb NOT NULL,
	"after_data" jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" DROP CONSTRAINT IF EXISTS "container_transfer_changes_transfer_id_container_transfers_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" ADD CONSTRAINT "container_transfer_changes_transfer_id_container_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "container_transfers"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" DROP CONSTRAINT IF EXISTS "container_transfer_changes_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "container_transfer_changes" ADD CONSTRAINT "container_transfer_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfer_changes_transfer_idx" ON "container_transfer_changes" ("transfer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "container_transfer_changes_created_at_idx" ON "container_transfer_changes" ("created_at");
