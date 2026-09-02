-- 容器管理：外部方（清关行、客户）没有本系统账号，流转两个方向都卡死。
--
-- 借出方向：单子停在 PENDING_RECEIVER，只有接收方能推进，而接收方压根登不进来，
-- 单子永久挂起并持续软占用转出方可用量（PENDING_OUTBOUND_STATUSES）。
-- 归还方向：创建流转要求操作人绑定转出方账户，内部人员录不进「清关行 → 我方」的归还单。
--
-- is_external 与 kind 解耦：清关行将来开了账号只需关掉开关，不必改代码或改 kind。
-- proxy_confirmed 标记「这一单是我方凭线下回单代对方确认的」，操作人与时间仍复用
-- responded_by / responded_at，凭证选填 —— 缺失时只能靠 response_note 追溯。
--
-- 三列都有默认值，存量行不受影响：既有账户一律非外部，既有流转一律非代确认。

ALTER TABLE "container_accounts" ADD COLUMN IF NOT EXISTS "is_external" boolean DEFAULT false NOT NULL;
ALTER TABLE "container_transfers" ADD COLUMN IF NOT EXISTS "proxy_confirmed" boolean DEFAULT false NOT NULL;
ALTER TABLE "container_transfers" ADD COLUMN IF NOT EXISTS "proxy_evidence_url" text;
