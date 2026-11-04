-- 飞书推送开放 API 的外部调用凭证
CREATE TABLE IF NOT EXISTS "feishu_open_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"token" varchar(128) NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "feishu_open_api_keys" ADD CONSTRAINT "feishu_open_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feishu_open_api_keys_token_unique" ON "feishu_open_api_keys" ("token");
