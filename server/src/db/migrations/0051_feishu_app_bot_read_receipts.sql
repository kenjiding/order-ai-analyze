-- 供应商推送配置新增 chat_id（自建应用机器人所在群，选填）；配置后该供应商推送改走应用机器人消息接口
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "chat_id" varchar(64);
--> statement-breakpoint
-- 记录通过应用机器人发出的消息（message_id），用于调用 read_users 接口查询已读名单
CREATE TABLE IF NOT EXISTS "feishu_push_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_config_id" uuid,
  "chat_id" varchar(64) NOT NULL,
  "message_id" varchar(64) NOT NULL,
  "msg_type" varchar(32) NOT NULL,
  "push_label" varchar(255),
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feishu_push_messages" ADD CONSTRAINT "feishu_push_messages_supplier_config_id_fleet_supplier_push_configs_id_fk" FOREIGN KEY ("supplier_config_id") REFERENCES "fleet_supplier_push_configs"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "feishu_push_messages" ADD CONSTRAINT "feishu_push_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feishu_push_messages_supplier_config_idx" ON "feishu_push_messages" ("supplier_config_id");
