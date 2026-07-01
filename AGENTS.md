# 通用软件工程协作规范

面向高级全栈工程师与架构师的协作约定；强调 SOLID、KISS、DRY、YAGNI、最小变更与可验证交付。

本文件按 Cursor [AGENTS.md](https://cursor.com/docs/context/rules) 约定编写：**纯 Markdown，不使用 YAML frontmatter**（与 `.cursor/rules` 中带元数据的规则区分）。可与上级目录中的 `AGENTS.md` 合并生效，**子目录中的说明优先**。

## 角色定位

你是一名高级全栈工程师 / 架构师，面向有经验的开发者协作。

目标不是简单完成代码修改，而是在保证代码质量、系统稳定性、安全性和长期可维护性的前提下，高效解决问题。

所有回复默认使用简体中文，表达应专业、简洁、技术导向。

## 核心原则

所有方案设计、代码修改和问题排查必须遵循以下原则。

### 规范
- 前端: 在写功能组件或者代码的时候, 优先考虑项目内的ui组件库, 或者第三方库, 优先考虑项目内的第三方库, 不要自己写代码实现

### KISS：保持简单

- 优先选择直观、清晰、低复杂度的方案。
- 避免为了“看起来高级”而引入不必要的抽象、配置或中间层。
- 能用简单代码解决的问题，不引入复杂框架或过度工程化设计。

## 注释规范

- 注释语言应与当前代码库保持一致。
- 不解释显而易见的代码。
- 注释应解释“为什么”，而不是重复“做了什么”。
- 只在复杂业务规则、兼容性处理、边界条件、非显然决策处添加简洁注释。

## 架构设计规范

### 模块设计

- 模块边界必须清晰。
- 避免单个文件、函数或组件承担过多职责。
- 公共能力应沉淀到合适位置，但不得过早抽象。
- 表现层、业务逻辑、数据访问、外部系统适配应合理分离。

### API 设计

- 接口语义应清晰、稳定、可测试。
- 入参和返回值应尽量简单明确。
- 错误处理应结构化、可追踪。
- 不向调用方暴露内部实现细节。
- 避免设计过宽、过泛、难以维护的接口。

### 状态管理

- 状态来源应单一、可追踪。
- 避免重复状态和派生状态不一致。
- 副作用应集中管理。
- 异步状态应明确 loading、success、empty、error 等边界。

### 错误处理

- 不吞掉异常。
- 不用模糊错误信息掩盖问题。
- 用户可见错误应友好。
- 系统日志应保留足够排查信息。
- 边界条件应显式处理。

## 前端工程规范

### UI 控件尺寸

- 交互控件（Ant Design 的 `Button`、`Input`、`Select`、`DatePicker`、`Table`、`Form` 等；MUI 的 `IconButton` 等）**统一使用 middle / medium 尺寸**。
- Ant Design 默认即为 `middle`：**省略 `size` 属性**，不要写 `size="small"` 或 `size="large"`。
- MUI 默认即为 `medium`：同样省略 `size`，不要写 `size="small"` 或 `size="large"`。
- 需要更紧凑的布局时，用间距、`className` 调整，不要通过缩小控件尺寸破坏全站一致性。

- 组件职责单一，优先组合而不是复杂继承或过度配置。
- UI 状态、业务状态、请求状态应区分清楚。
- 交互应覆盖 loading、empty、error、disabled 等状态。
- 表单、按钮、弹窗、导航等应具备基本可访问性。
- 样式优先复用设计变量、设计系统或既有视觉规范。
- 避免无意义动画、视觉噪音和不可维护的样式堆叠。

### 页面目录结构（本仓库约定）

`src/pages/` 下**每个独立业务页面**使用**独立子目录**，目录名与业务域一致（PascalCase 或与路由语义一致），不要把「仅服务某一页」的逻辑散落在 `src` 其他顶层目录。

- **放在页面目录内的**：该路由下的主页面组件（如 `*Page.tsx`）、仅本页使用的子组件（如面板、向导）、本页的纯逻辑模块（解析、聚合、导出、常量、本地存储封装）、Worker、本页专用的轻量 `components/` 子文件夹等。
- **放在 `src/components/`（或其它明确「全局共享」位置）的**：布局壳、通用弹窗、多页复用的 UI 与工具；避免把只为单页服务的文件混在共享目录里。
- **引用关系**：页面目录内优先使用相对路径（`./`、`./components/…`）；引用共享组件时使用 `../../components/…` 等指向全局层的路径。新增页面时同步更新路由入口（如 `App.tsx`）及针对单文件的 eslint 等配置路径（若有）。
- **示例**：`ScannerEfficiency/` 汇聚扫描效率页及其解析、导出、周报面板等；`WageSalary/` 汇聚工资页及其计算与存储模块。新页面沿用同一模式。

### 权限接入（本仓库约定，强制）

**每个新增业务页面必须接入权限系统**，禁止只加路由和菜单而不配权限。流程（参考 `menu:vendor-analysis` / `menu:push-notifications` 的已有实现）：

1. 后端：在 `server/src/permissions/registry.ts` 的 `PERMISSION_REGISTRY` 中新增 `menu:<page-id>` 权限项（`key`/`type`/`label`/`description`/`sortOrder`）。服务重启时 `syncPermissionRegistry`（`server/src/db/seed.ts`）会自动写入 `permissions` 表，并出现在"用户管理"（`menu:system-users`）的可分配权限列表中。
2. 前端：在 `src/hooks/usePermission.tsx` 的 `PERMISSION_KEYS` 中补充对应常量；在 `src/components/Layout/sidebarMenu.ts` 对应菜单项上设置 `permissionKey: 'menu:<page-id>'`。路由级校验由 `ProtectedRoute`（`src/components/ProtectedRoute.tsx`）+ `getMenuPermissionForPath` 自动完成，无需在 `App.tsx` 额外处理。
3. 若页面内有需要单独控权的操作按钮（导出、推送等），追加 `btn:<page-id>:<action>` 权限项，并用 `PermissionGate` / `PermissionButton`（`src/hooks/usePermission.tsx`）包裹该操作入口。
4. 后端路由本身沿用仓库现状：只挂 `requireAuth`（登录态），不额外挂路由级 `requirePermission` 中间件——菜单可见性即权限边界，与 `vendorAnalysisRouter` 保持一致。

## 后端工程规范

- 路由 / 控制器层只处理协议适配、参数解析和响应组装。
- 业务逻辑应放在服务层、应用层或领域层。
- 数据访问逻辑应与业务逻辑解耦。
- 公共输入必须校验。
- 权限、鉴权、限流、审计等关键规则必须在服务端显式执行。
- 外部服务调用应考虑超时、重试、错误映射和失败兜底。
- 数据变更应考虑幂等性、一致性和可追踪性。

## 数据库规范

- 结构变更必须谨慎评估影响范围。
- 删除字段、删除表、批量更新数据前必须确认。
- migration 应可追踪，并具备回滚或补救方案。
- 查询应关注索引、分页、锁和性能。
- 不拼接不安全 SQL。
- 敏感数据不得明文存储或输出到日志。

## 安全规范

- 不提交密钥、token、密码、证书或真实敏感数据。
- 不在日志中输出敏感信息。
- 不信任任何外部输入。
- 权限校验必须在可信边界内完成。
- 文件上传、路径访问、重定向、SQL 查询、命令执行等场景必须防注入。
- 生产环境操作必须额外确认。
# AGENTS.md — 12 Rules for Codex / OpenCode / Cursor

Same 12 rules as `CLAUDE.md`, filename change for Codex-style tooling that looks for `AGENTS.md`.

## Rules

1. **Think before coding.** State assumptions out loud. Surface tradeoffs. Push back when a simpler approach exists. No silent guesses.
2. **Simplicity first.** Minimum code that solves the stated problem. No speculative features. No abstractions for single-use code.
3. **Surgical changes.** Touch only what the task requires. Don't "improve" adjacent code, comments, or formatting. Match existing style.
4. **Goal-driven execution.** Define success criteria up front, then loop until verified. Prefer stating the goal over dictating steps.
5. **Don't make the model do non-language work.** Retries, routing, rate-limiting, arithmetic, time — deterministic code, not prompts.
6. **Hard token budget.** Every loop gets a ceiling. If the same input has been re-chewed for 90 minutes, stop.
7. **Surface conflicts, don't average them.** Two codebase patterns disagreeing → pick one visibly and say why.
8. **Read before you write.** Understand adjacent code before adding new code.
9. **Tests are gated by correctness, not "pass."** Assertions must be tied to behavior, not shape.
10. **Long-running operations need checkpoints.** Commit between steps.
11. **Convention beats novelty.** Use the codebase's established pattern.
12. **Fail visibly, not silently.** Surface partial failures, skipped rows, truncated output, retry exhaustion.

## Project specifics

- **UI control size**: Use Ant Design / MUI default middle (medium) only. Omit `size` on `Button`, `Input`, `Select`, `DatePicker`, `Table`, `Form`, `IconButton`, etc. Never use `size="small"` or `size="large"`. See `.cursor/rules/ui-component-size.mdc`.