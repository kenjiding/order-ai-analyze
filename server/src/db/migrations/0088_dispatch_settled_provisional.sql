-- 「立刻统计」手动跑出来的派签结果改成也落库盖章（dispatch_settled_at 不再永远留空），
-- 但打上 provisional 标记，让站点自己的定时任务到点后仍能识别出这行还没被权威结果覆盖过、
-- 需要重跑一次；定时任务跑完后把这一列改回 false。页面不区分展示，统一显示「已结算」。
ALTER TABLE "dispatch_performance_settled_batches"
  ADD COLUMN IF NOT EXISTS "dispatch_settled_provisional" boolean NOT NULL DEFAULT false;
