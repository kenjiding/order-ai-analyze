# CLAUDE.md — Claude Code 协作规范

与 `AGENTS.md` 共享同一套工程约定；Claude Code 会优先读取本文件。详细中文规范见 `AGENTS.md`。

## 12 Rules

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

- **UI control size (mandatory)**: Ant Design and MUI controls use **middle / medium only**. Omit the `size` prop on `Button`, `Input`, `Select`, `DatePicker`, `Table`, `Form`, `Radio.Group`, `IconButton`, etc. **Never** use `size="small"` or `size="large"`. For tighter layout, adjust spacing or `className` — not control size. Details: `.cursor/rules/ui-component-size.mdc` and `AGENTS.md` §前端工程规范.

- **Page structure**: Page-scoped code lives under `src/pages/<PageName>/`. Shared shell under `src/components/`.

- **UI libraries**: Prefer Ant Design (themed in `src/theme/antdTheme.ts`); use MUI only where already established (e.g. Tabs, Tooltip in ScannerEfficiency).

- **Permissions (mandatory)**: every new page must be wired into the permission system — no route/menu without a matching permission. Register `menu:<page-id>` in `server/src/permissions/registry.ts`, add the constant in `src/hooks/usePermission.tsx`'s `PERMISSION_KEYS`, and set `permissionKey` on its `src/components/Layout/sidebarMenu.ts` entry — this makes it assignable from "用户管理" and auto-enforced by `ProtectedRoute`. Full flow: `AGENTS.md` §权限接入.

- **Menu i18n (mandatory)**: `sidebarMenu.ts`'s `label`/`description` are placeholders only — never rendered. The sidebar reads `menu.json`'s `items.<page-id>` (both locales); the permission-assignment UI reads `permission.json`'s `menu:<page-id>` (both locales). Skip either and the menu either shows a raw untranslated key or silently falls back to the Chinese label in English mode. Every new menu item needs all 4 keys added: `src/i18n/locales/{zh-CN,en}/menu.json` → `items.<page-id>`, and `src/i18n/locales/{zh-CN,en}/permission.json` → `menu:<page-id>`. Full flow: `AGENTS.md` §菜单多语言接入.

- **Page content i18n is opt-in**: the mandatory menu i18n above only covers the sidebar entry and permission label. For a page's own content (labels, table columns, button text, etc.), do NOT add i18n unless the user explicitly asks for that page to support multiple languages. Default to hardcoded Chinese text in new/changed pages.
