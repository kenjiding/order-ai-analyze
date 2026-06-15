# Taste Skill 使用指南

本项目已集成 [taste-skill](https://github.com/Leonxlnx/taste-skill) —— 一套面向 AI Agent 的前端设计 Skill，用于生成更有品味、更少「AI 模板感」的界面。

适用于 **Cursor**、**Codex**、**Claude Code**。

---

## 安装位置

| 工具 | 路径 | 说明 |
|------|------|------|
| Cursor | `~/.agents/skills/` | 直接读取 universal skills |
| Codex | `~/.agents/skills/` | 直接读取 universal skills |
| Claude Code | `~/.claude/skills/` | 软链接到 `~/.agents/skills/` |

版本锁定文件：`~/.agents/.skill-lock.json`

---

## 已安装的 Skill 一览

### 实现类（输出代码）

| Skill 名称 | 适用场景 |
|------------|----------|
| `design-taste-frontend` | **默认首选**。落地页、作品集、改版；v2 实验版，自动推断设计方向 |
| `design-taste-frontend-v1` | v1 原版，仅在需要与旧行为完全一致时使用 |
| `gpt-taste` | GPT/Codex 专用变体；更严格的布局变化与 GSAP 动效 |
| `image-to-code` | 图生码流程：先生成设计图 → 分析 → 按图实现 |
| `redesign-existing-projects` | 改造现有项目 UI，先审计再优化，不破坏功能 |
| `high-end-visual-design` | 高端视觉：精致字体、间距、阴影、动效 |
| `minimalist-ui` | 极简编辑风（Notion / Linear 气质） |
| `industrial-brutalist-ui` | 工业粗野主义：瑞士排版 + 军事终端美学 |
| `stitch-design-taste` | Google Stitch 兼容，可导出 `DESIGN.md` |
| `full-output-enforcement` | 防止 Agent 输出截断或留占位符 |

### 图像生成类（仅输出设计参考图，不写代码）

| Skill 名称 | 适用场景 |
|------------|----------|
| `imagegen-frontend-web` | 网页设计稿：Hero、落地页、多区块排版 |
| `imagegen-frontend-mobile` | 移动端界面与流程（iOS / Android） |
| `brandkit` | 品牌视觉板：Logo 方向、色板、字体、应用示例 |

---

## 如何选择 Skill

```
需要做什么？
│
├─ 新建落地页 / 作品集
│   └─ design-taste-frontend（默认）
│
├─ 改造现有页面 UI
│   └─ redesign-existing-projects
│
├─ 有设计图，要按图写代码
│   └─ image-to-code
│
├─ 只要设计参考图，不写代码
│   ├─ 网页 → imagegen-frontend-web
│   ├─ 移动端 → imagegen-frontend-mobile
│   └─ 品牌视觉 → brandkit
│
├─ 已有明确视觉方向
│   ├─ 极简 → minimalist-ui
│   ├─ 高端精致 → high-end-visual-design
│   └─ 粗野工业 → industrial-brutalist-ui
│
├─ 在 Codex 中需要更强动效 / 布局
│   └─ gpt-taste
│
├─ Agent 总是输出半截代码
│   └─ full-output-enforcement（可与其他 skill 叠加）
│
└─ 使用 Google Stitch
    └─ stitch-design-taste
```

---

## 使用方式

在 Cursor / Codex / Claude Code 的对话中，直接引用 skill 名称即可。

### 通用落地页

```
用 design-taste-frontend skill 帮我做一个 B2B SaaS 落地页，风格接近 Linear，面向技术决策者。
```

### 作品集

```
follow design-taste-frontend skill：为独立设计师做一个作品集页，编辑感排版，偏 Awwwards 实验风。
```

### 改造现有项目

```
用 redesign-existing-projects skill 审计并优化 src/pages/HomePage.tsx 的视觉层次，保持现有功能不变。
```

### 图生码流程

```
follow image-to-code skill：先生成各区块设计图，分析后再实现完整落地页。
```

### 仅生成设计参考图

```
用 imagegen-frontend-web skill 为一个 AI 写作工具生成 8 个区块的横向设计稿，每区块一张图。
```

```
用 imagegen-frontend-mobile skill 为打卡 App 生成 iOS 主流程 5 屏 mockup。
```

```
用 brandkit skill 为一个开发者工具生成品牌视觉板，暗色科技风。
```

### 指定视觉风格

```
用 minimalist-ui skill 做一个产品定价页，克制配色，无渐变无重阴影。
```

```
用 industrial-brutalist-ui skill 做一个数据仪表盘，瑞士排版 + 高对比终端感。
```

```
用 high-end-visual-design skill 做一个奢侈品电商首页，精致留白与高级字体。
```

### Codex 强化版

```
用 gpt-taste skill 实现带 GSAP ScrollTrigger 的滚动叙事落地页。
```

### 防止输出截断

```
用 full-output-enforcement skill，完整输出所有组件代码，不要占位符。
```

### 图生码 + 图像生成组合

```
follow image-to-code skill：先用 imagegen-frontend-web 生成各区块参考图，分析后实现网站。
```

---

## design-taste-frontend 三个调节参数

默认 skill 顶部有三个 1–10 的拨盘，可在对话中覆盖，无需改文件：

| 参数 | 含义 | 低值 | 高值 |
|------|------|------|------|
| `DESIGN_VARIANCE` | 布局实验性 | 居中对称 | 不对称 / 实验布局 |
| `MOTION_INTENSITY` | 动效强度 | 仅 hover | 滚动叙事 / 物理动效 |
| `VISUAL_DENSITY` | 信息密度 | 画廊式留白 | 仪表盘式密集 |

**默认基线：** `8 / 6 / 4`

### 对话中覆盖示例

```
用 design-taste-frontend skill，DESIGN_VARIANCE=5，MOTION_INTENSITY=3，VISUAL_DENSITY=2，
做一个极简 B2B 落地页。
```

### 常用预设

| 场景 | VARIANCE | MOTION | DENSITY |
|------|----------|--------|---------|
| SaaS 落地页 | 7 | 6 | 4 |
| 创意机构落地页 | 9 | 8 | 3 |
| 设计师作品集 | 8 | 7 | 3 |
| 开发者作品集 | 6 | 5 | 4 |
| 极简 / Linear 风 | 5–6 | 3–4 | 2–3 |
| 公共部门 / 信任优先 | 3–4 | 2–3 | 4–5 |

---

## 维护命令

```bash
# 查看已安装 skill
npx skills ls -g

# 按工具筛选
npx skills ls -g -a cursor
npx skills ls -g -a codex
npx skills ls -g -a claude-code

# 更新到最新版
npx skills update -g -y

# 仅安装默认 skill（新机器初始化）
npx skills add https://github.com/Leonxlnx/taste-skill \
  -g -y -a cursor codex claude-code \
  --skill design-taste-frontend

# 安装全部 13 个 skill
npx skills add https://github.com/Leonxlnx/taste-skill \
  -g -y -a cursor codex claude-code -s '*'
```

---

## 与本项目的关系

- 本仓库为 **Ant Design 管理后台**，日常业务页以功能与一致性为主，**不必**对所有页面套用 taste-skill。
- 适合使用的场景：营销落地页、对外展示页、需要强视觉表达的新页面或改版。
- 项目内 UI 规范仍以 `AGENTS.md`、`.cursor/rules/ui-component-size.mdc` 为准（如 Ant Design 控件统一 middle 尺寸）。

---

## 参考链接

- 仓库：[Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)
- 官网：[tasteskill.dev](https://tasteskill.dev)
- Skill 索引：[skills.sh/Leonxlnx/taste-skill](https://skills.sh/Leonxlnx/taste-skill)
