-- 飞书卡片按钮点击事件：卡片按钮 open_url + callback 双行为回调落库，供「推送数据监控」页面统计谁点了 View Details / Resolve Tickets
CREATE TABLE IF NOT EXISTS "feishu_card_click_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" varchar(64) NOT NULL,
  "supplier_config_id" uuid,
  "chat_id" varchar(64) NOT NULL,
  "open_id" varchar(64) NOT NULL,
  "action_type" varchar(32) NOT NULL,
  "push_type" varchar(32) NOT NULL,
  "clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feishu_card_click_events" ADD CONSTRAINT "feishu_card_click_events_supplier_config_id_fleet_supplier_push_configs_id_fk" FOREIGN KEY ("supplier_config_id") REFERENCES "fleet_supplier_push_configs"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feishu_card_click_events_message_idx" ON "feishu_card_click_events" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feishu_card_click_events_supplier_config_idx" ON "feishu_card_click_events" ("supplier_config_id");
