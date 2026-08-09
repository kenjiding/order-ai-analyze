-- 飞书官方 CardActionHandler 回调（InteractiveCardActionEvent）payload 里没有 chat_id 字段，
-- 现有代码也从未读取这一列（查群成员时用的是 feishu_push_messages.chat_id），属于死字段，去掉
ALTER TABLE "feishu_card_click_events" DROP COLUMN IF EXISTS "chat_id";
