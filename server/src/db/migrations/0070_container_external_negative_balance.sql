-- 外部方（清关行、客户、CSP）的容器台账允许为负。
--
-- 他们的余额是衍生推算量：系统上线前就借出去的存量、走系统外补的货，都不在账上。
-- 用这个数去拦「容器已经回到我方仓库」的既成事实，结果是我方的真实入库反而记不进账，
-- 而且外部方账户不绑定任何用户，除超管外没人能给它补录期初台账，等于把归还单彻底堵死。
-- 负数是有用的对账信号：清关行 -12 就是「有 12 个的借出没进系统」。
--
-- CHECK 约束没法跨表判断账户是不是外部方，只能整个去掉。非负保护改由应用层承担，覆盖全部写入路径：
--   1. 手工台账 CRUD：路由层 POST/PATCH /balances 校验 quantity >= 0
--   2. 流转入账：applyBalances 校验转出方余额，仅当转出方 isExternal 时放行为负
-- 存量数据不受影响：既有余额都是非负的，这里只是不再阻止将来出现负数。

ALTER TABLE "container_balances" DROP CONSTRAINT IF EXISTS "container_balances_quantity_non_negative";
