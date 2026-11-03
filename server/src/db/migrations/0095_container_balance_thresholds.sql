-- 容器管理：站点账户容器数量水位线告警（账户 × 品类），越界时推送飞书群通知
CREATE TABLE IF NOT EXISTS "container_balance_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"container_type" varchar(32) NOT NULL,
	"min_qty" integer,
	"max_qty" integer,
	"last_alert_direction" varchar(8),
	"last_alert_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container_balance_thresholds" ADD CONSTRAINT "container_balance_thresholds_account_id_container_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "container_accounts"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "container_balance_thresholds_account_type_unique" ON "container_balance_thresholds" ("account_id","container_type");
