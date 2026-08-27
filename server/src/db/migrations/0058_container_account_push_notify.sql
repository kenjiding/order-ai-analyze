-- 主体账户上挂飞书通知配置：流转记录发生变更时，转出方与接收方各自配置的
-- 联系人都会收到私聊。选群仅用于拉取成员名单，与 iMile token 失效通知同一套做法。
ALTER TABLE "container_accounts"
  ADD COLUMN IF NOT EXISTS "push_notify" jsonb NOT NULL DEFAULT '{"enabled":false,"chatId":"","mentions":[]}'::jsonb;
