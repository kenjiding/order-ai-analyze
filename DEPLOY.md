# 阿里云 ECS 部署手册

本文档说明如何将本项目（前端 + 后端）部署到阿里云 ECS，以及日常运维常用命令。

**所有发版命令均在项目根目录执行**，除非特别说明。

---

## 架构概览

```
浏览器
  │
  ▼
Nginx :80
  ├─ /              → /var/www/app/dist（前端静态资源）
  └─ /api/*         → 127.0.0.1:8787（Podman 后端 API）

本地开发机                         阿里云 ECS
┌──────────────────┐              ┌──────────────────────────────────────┐
│ pnpm ecs:upload-web│ tar + ssh   │  /var/www/app/dist（Nginx root）     │
│ pnpm ecs:deploy-web│ ──────────► │                                      │
└──────────────────┘              │  /home/aus-user/app/server/          │
┌──────────────────┐              │  podman compose（3 个固定容器）      │
│ pnpm --dir server│ tar + ssh    │  ├─ warehouse-postgres  :5432 内网  │
│   ecs:deploy     │ ──────────►  │  ├─ warehouse-server    :8787 内网  │
└──────────────────┘              │  └─ warehouse-worker   后台任务     │
                                  └──────────────────────────────────────┘
```

| 组件 | 说明 |
|------|------|
| Nginx | 对外 `:80`，托管前端并反代 `/api` |
| `/var/www/app/dist` | 前端构建产物（`pnpm build --mode ecs` 的 `dist/`） |
| `warehouse-postgres` | PostgreSQL 16，数据持久化在 volume `*_postgres_data` |
| `warehouse-server` | Express API，映射 `8787`（通常仅本机 / Nginx 访问） |
| `warehouse-worker` | 定时任务 / 队列消费，与 API 共用镜像 |

持久化数据（**部署不会删除**）：

- `postgres_data` — 数据库
- `job_artifacts` — 任务产物文件

---

## 快速发版（最常用）

| 场景 | 命令 |
|------|------|
| 仅发前端 | `pnpm ecs:upload-web` |
| 仅发后端 | `pnpm --dir server ecs:deploy` |
| 前后端都发 | 依次执行上面两条 |
| 前端 + reload Nginx | `pnpm ecs:deploy-web` |

---

## 部署脚本说明

> 脚本看起来多，日常只需记一条命令。以下说明哪些必须、哪些不用管。

### 你需要记住的

| 场景 | 命令 | 执行位置 |
|------|------|----------|
| **后端发版**（最常用） | `pnpm --dir server ecs:deploy` | 本地项目根目录 |
| **前端发版** | `pnpm ecs:upload-web` | 本地项目根目录 |
| **新 ECS 一次性加固** | `./scripts/ecs-install-systemd.sh` | SSH 登录 ECS 后 |
| **紧急自救**（服务挂了） | `./scripts/ecs-ensure-running.sh` | SSH 登录 ECS 后 |

其余脚本由上述命令**自动调用**，或仅本地开发使用，不必背诵。

### 后端脚本（`server/scripts/`）

| 脚本 | 是否必须 | 谁执行 | 作用 |
|------|----------|--------|------|
| `ecs-upload.sh` | ✅ 必须 | **本地** | `tar + ssh` 上传代码；`--deploy` 时附带 `.env` 并触发远端部署 |
| `ecs-deploy.sh` | ✅ 必须 | **ECS** | `podman-compose` 构建镜像、启停容器；子命令 `up` / `restart` / `down` / `logs` / `health` / `ensure` |
| `ecs-install-systemd.sh` | ⚠️ 一次性 | **ECS** | 启用 linger、安装 `warehouse-app.service` 与 `warehouse-watchdog.timer`（防止 SSH 断开后容器被杀） |
| `ecs-ensure-running.sh` | 🔧 辅助 | **ECS**（看门狗定时调用） | 检查 3 个容器状态与 `/health`；异常则 `start` 或 `compose` 重建 |
| `init-local-db.sh` | ❌ 与 ECS 无关 | **本地开发** | 初始化本机 Postgres，线上不用 |

**`pnpm --dir server ecs:deploy` 内部调用链：**

```
ecs:deploy（package.json）
  └─ ecs-upload.sh --deploy          ← 本地：上传代码 + .env
       └─ ecs-deploy.sh restart     ← ECS：构建 + 强制重建容器
            └─ ecs-ensure-running.sh ← ECS：发版后顺带健康检查
```

### 前端脚本（项目根 `scripts/`）

| 脚本 | 是否必须 | 作用 |
|------|----------|------|
| `ecs-upload-web.sh` | 发前端时要 | `pnpm build --mode ecs` 后上传 `dist/` 到 Nginx 目录 |

对应 npm 命令：`pnpm ecs:upload-web`、`pnpm ecs:deploy-web`（含 reload Nginx）。

### 与部署无关的脚本

| 脚本 | 用途 |
|------|------|
| `scripts/export-fleet-supplier-config.console.js` | 业务：车队供应商配置导出 |
| `scripts/calibrateScannerReliabilityBases.ts` | 业务：扫描效率校准 |

### Linger + 看门狗装在哪？

**仓库里（Git）：**

- `server/scripts/ecs-install-systemd.sh` — 安装器
- `server/scripts/ecs-ensure-running.sh` — 看门狗逻辑

**ECS 上（执行安装脚本后生成，不在 Git）：**

| 路径 | 作用 |
|------|------|
| `loginctl enable-linger aus-user` | 用户登出后 user systemd 不退出 |
| `~/.config/systemd/user/warehouse-app.service` | 开机/登录后 `podman-compose up -d` |
| `~/.config/systemd/user/warehouse-watchdog.timer` | 每 5 分钟触发健康检查 |

验证：

```bash
loginctl show-user aus-user -p Linger          # yes
systemctl --user status warehouse-app.service
systemctl --user list-timers warehouse-watchdog.timer
```

`ecs:deploy` **不会**每次重装 linger/看门狗；换新 ECS 或重装系统时需再执行一次 `ecs-install-systemd.sh`。

### 为什么不合并成一个脚本？

| 拆分方式 | 原因 |
|----------|------|
| `upload` 与 `deploy` 分开 | 支持「只上传代码、不重启」 |
| `ensure` 独立 | 给看门狗定时任务和 `restart` 复用 |
| `install-systemd` 独立 | 明确「一次性安装」，不混进每次发版 |

**结论：5 个后端脚本里，你主动常用的实质只有 1 条命令 `ecs:deploy`；另外 2 个是一次性/看门狗，`init-local-db.sh` 仅本地开发。**

---

## 前置条件

### 本地（macOS）

```bash
# 密码登录需要 sshpass（推荐改用 SSH 密钥则可不装）
brew install hudochenkov/sshpass/sshpass
```

### ECS（首次，执行一次）

**后端（Podman）：**

```bash
# Alibaba Cloud Linux 3
sudo dnf install -y podman podman-compose

podman --version
podman-compose --version   # 或 podman compose version

# 一次性：防止 SSH 断开后容器被杀（见「502 故障排查」）
cd /home/aus-user/app/server
./scripts/ecs-install-systemd.sh
```

**前端（Nginx）：**

Nginx 需已安装并配置站点，示例 `/etc/nginx/conf.d/app.conf`：

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/app/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 12m;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8787/health;
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

查看当前 Nginx 配置：

```bash
sudo nginx -T 2>/dev/null | grep -E 'listen |root |proxy_pass|location'
```

**安全组：**

- 放行 **80**（HTTP 前端）
- **8787** 可按需仅内网访问（经 Nginx 反代时不必对公网开放）

---

## 首次配置

### 1. SSH 连接（前后端共用）

```bash
cd server
cp .env.ecs-upload.example .env.ecs-upload
vim .env.ecs-upload
```

`.env.ecs-upload` 示例：

```bash
ECS_HOST=47.83.235.214
ECS_USER=aus-user
ECS_SSH_PORT=22
ECS_REMOTE_DIR=/home/aus-user/app/server

# 二选一
ECS_SSH_KEY=~/.ssh/id_rsa          # 推荐
# ECS_PASSWORD=your-password       # 需安装 sshpass
```

> `.env.ecs-upload` 是 **SSH 上传配置**；`server/.env` 是 **应用运行时配置**。二者不同，均不要提交 Git。

### 2. 后端应用环境变量

```bash
cd server
cp .env.example .env
vim .env
```

线上务必修改至少：

- `JWT_SECRET`
- `SUPER_ADMIN_PASSWORD`
- `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 等按需填写
- **`AUTH_COOKIE_SECURE=false`** — 若使用 **HTTP**（无 TLS），必须设置，否则登录后 Cookie 无法写入、接口全 401

`compose.yaml` 会将容器内 `DATABASE_URL` 覆盖为 compose 内网地址；本地 `.env` 里的 `DATABASE_URL=...@127.0.0.1` 仅影响本地开发。

前端经 Nginx 同源反代 `/api` 时，**不必**单独配置 `CORS_ORIGIN`。

### 3. 前端部署配置（可选）

默认即可；若 Nginx `root` 或 sudo 策略不同，再覆盖：

```bash
cp .env.ecs-web.example .env.ecs-web
vim .env.ecs-web
```

`.env.ecs-web` 示例：

```bash
ECS_WEB_REMOTE_DIR=/var/www/app/dist
ECS_WEB_USE_SUDO=auto    # /var/www 下自动 sudo 写入
```

`/var/www` 目录若 `aus-user` 无写权限，需无密码 sudo，或将目录授权：

```bash
sudo mkdir -p /var/www/app
sudo chown -R aus-user:aus-user /var/www/app
# 然后在 .env.ecs-web 设 ECS_WEB_USE_SUDO=false
```

### 4. 首次部署

```bash
# 项目根目录
pnpm --dir server ecs:deploy    # 后端
pnpm ecs:upload-web             # 前端
```

---

## 后端部署

### 日常发版

```bash
# 一键：上传代码 + .env + 重建容器（推荐）
pnpm --dir server ecs:deploy

# 仅上传代码，不重启
pnpm --dir server ecs:upload

# 上传代码和 .env，不重启
bash server/scripts/ecs-upload.sh --with-env
```

### `ecs:deploy` 会做什么 / 不会做什么

| 会做 | 不会做 |
|------|--------|
| 同步最新 `server/` 代码到 ECS | 删除数据库 volume |
| 覆盖远端 `server/.env` | 自动清理悬空镜像 |
| 构建新镜像 | 创建额外副本容器 |
| 删除旧容器并 `--force-recreate` 重建 3 个服务 | |

每次部署后应只有 **3 个** `warehouse-*` 容器在运行。

### 后端脚本（`server/scripts/`）

**本地执行 `ecs-upload.sh`：**

```bash
bash server/scripts/ecs-upload.sh              # 仅上传
bash server/scripts/ecs-upload.sh --deploy     # 上传 + 远端 restart
bash server/scripts/ecs-upload.sh --with-env   # 上传时附带 .env
bash server/scripts/ecs-upload.sh -h           # 帮助
```

**ECS 上执行 `ecs-deploy.sh`：**

```bash
cd /home/aus-user/app/server

./scripts/ecs-deploy.sh up        # 首次启动 / 增量 up
./scripts/ecs-deploy.sh restart   # 强制重建（发版推荐）
./scripts/ecs-deploy.sh down      # 停止并移除容器（保留 volume）
./scripts/ecs-deploy.sh logs      # 跟踪日志
./scripts/ecs-deploy.sh health      # 健康检查
./scripts/ecs-deploy.sh build       # 仅构建镜像
```

### 本地 Podman（开发 / 联调）

```bash
pnpm --dir server podman:up      # 本地启动全栈
pnpm --dir server podman:down    # 本地停止
```

---

## 前端部署

前端使用 **httpOnly Cookie** 登录；生产构建走 **同源 `/api`**（`VITE_API_BASE` 留空），由 Nginx 反代到后端。

### 日常发版

```bash
# 构建（--mode ecs）+ 上传到 /var/www/app/dist
pnpm ecs:upload-web

# 构建 + 上传 + reload Nginx（纯静态替换通常不必 reload）
pnpm ecs:deploy-web

# 跳过构建，仅上传已有 dist/
./scripts/ecs-upload-web.sh --no-build
```

### 构建说明

- 命令内部执行 `pnpm build --mode ecs`
- 使用根目录 `.env.ecs`（不设置 `VITE_API_BASE`，API 走 Nginx `/api`）
- 产物目录：`dist/` → 远端 `ECS_WEB_REMOTE_DIR`（默认 `/var/www/app/dist`）

### 前端脚本选项

```bash
./scripts/ecs-upload-web.sh              # 构建 + 上传
./scripts/ecs-upload-web.sh --no-build   # 仅上传
./scripts/ecs-upload-web.sh --reload-nginx
./scripts/ecs-upload-web.sh -h           # 帮助
```

### 配置优先级

环境变量 > `.env.ecs-web` > `server/.env.ecs-upload`

| 变量 | 说明 | 默认 |
|------|------|------|
| `ECS_WEB_REMOTE_DIR` | 远端静态目录 | `/var/www/app/dist` |
| `ECS_WEB_USE_SUDO` | `auto` / `true` / `false` | `auto`（`/var/www` 下自动 sudo） |
| `ECS_WEB_BUILD_MODE` | Vite 构建 mode | `ecs` |

---

## ECS 常用运维命令

### 登录

```bash
ssh aus-user@47.83.235.214

# 后端
cd /home/aus-user/app/server

# 前端静态目录
ls -la /var/www/app/dist
```

### 后端状态

```bash
podman ps -a --filter name=warehouse

curl http://127.0.0.1:8787/health
# 期望：{"ok":true,"db":"up"}

podman logs --tail 100 warehouse-server
podman logs --tail 100 warehouse-worker
```

### Nginx

```bash
sudo nginx -t
sudo systemctl status nginx
sudo systemctl reload nginx
```

### 重启 / 停止后端

```bash
cd /home/aus-user/app/server
./scripts/ecs-deploy.sh restart
./scripts/ecs-deploy.sh down

podman restart warehouse-server   # 单容器
```

### 清理磁盘

```bash
podman image prune -f
podman volume ls | grep server
```

### 数据库

```bash
podman exec -it warehouse-postgres psql -U warehouse -d warehouse

podman exec warehouse-postgres psql -U warehouse -d warehouse \
  -c "SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;"
```

---

## 故障排查

### 登录 200 但后续接口全 401

**原因：** 生产环境 Cookie 默认 `Secure`，在 **HTTP** 下浏览器不会保存。

**处理：** 在 `server/.env` 设置 `AUTH_COOKIE_SECURE=false`，重新部署后端：

```bash
pnpm --dir server ecs:deploy
```

验证：DevTools → Application → Cookies，登录后应出现 `warehouse_auth`（无 `Secure` 标志）。

上 HTTPS 后改回 `AUTH_COOKIE_SECURE=true` 或删除该行。

### `curl -sf http://127.0.0.1:8787/health` 无输出

`-sf` 在失败时静默。改用：

```bash
curl -v http://127.0.0.1:8787/health
podman logs --tail 50 warehouse-server
```

常见原因：迁移失败、容器反复重启、8787 未监听。

### 容器 `unhealthy` 但 curl 正常

发版重建后应恢复：

```bash
./scripts/ecs-deploy.sh restart
```

### 代码更新了但行为没变

```bash
podman ps -a --filter name=warehouse-server
# 看 CREATED 时间是否为最近发版时间
```

后端应使用 `ecs:deploy`（内部走 `restart`），不要仅用 `up`。

### 前端页面空白或 404

```bash
ls -la /var/www/app/dist/index.html
sudo nginx -t
curl -I http://127.0.0.1/
```

确认 Nginx `root` 与 `ECS_WEB_REMOTE_DIR` 一致，且存在 `try_files ... /index.html`。

### 迁移失败：`column "username" does not exist`

若 ECS 数据库处于半初始化状态：

```bash
./scripts/ecs-deploy.sh down
podman volume rm server_postgres_data   # ⚠️ 会清空数据库
./scripts/ecs-deploy.sh restart
```

### Nginx 502 Bad Gateway（昨晚还好，今早全挂）

**现象：**

- 浏览器 `502 Bad Gateway`（Nginx 正常，后端不可达）
- `podman ps` 为空或容器全是 `Created` / 未 `Up`
- `podman ps` 可能出现 `acquiring lock ... file exists`

**根因（2026-06-14 事故）：**

1. 后端用 **rootless Podman**，容器挂在 **用户级 systemd 会话**（`systemd[81565]`）上
2. 凌晨 **06:45** SSH 会话 / user systemd **正常退出**（`Linger=no`）
3. 退出时 **杀掉所有 podman scope**，三个 `warehouse-*` 容器同时停止
4. `restart: unless-stopped` **无法生效**——没有持久的 user systemd 来拉起它们
5. Podman 锁文件异常，容器状态显示为 `Created`，直到人工 `podman start`

**不是**应用代码 bug，而是 **部署架构缺少持久化与自愈**。

**立即恢复：**

```bash
cd /home/aus-user/app/server
./scripts/ecs-ensure-running.sh
# 或
./scripts/ecs-deploy.sh ensure
curl http://127.0.0.1:8787/health
```

**一次性加固（ECS 上执行，已提供脚本）：**

```bash
cd /home/aus-user/app/server
./scripts/ecs-install-systemd.sh
```

会做：

| 措施 | 作用 |
|------|------|
| `loginctl enable-linger aus-user` | 用户登出后 **user systemd 不退出** |
| `warehouse-app.service` | 登录/开机后自动 `podman-compose up -d` |
| `warehouse-watchdog.timer` | **每 5 分钟** 检查 health，异常则拉起 |

验证：

```bash
loginctl show-user aus-user -p Linger    # yes
systemctl --user status warehouse-app.service
systemctl --user list-timers warehouse-watchdog.timer
```

---

## 安全提醒

- **不要**将 `.env`、`.env.ecs-upload`、`.env.ecs-web` 提交到 Git
- 生产环境务必修改 `JWT_SECRET`、`SUPER_ADMIN_PASSWORD`、数据库密码
- 推荐使用 **SSH 密钥** 替代密码登录
- HTTP 部署仅适合内网或临时环境；公网生产建议配置 HTTPS 并启用 `AUTH_COOKIE_SECURE=true`

---

## 文件索引

> 各脚本是否必须、调用关系见上文 **[部署脚本说明](#部署脚本说明)**。

| 文件 | 用途 |
|------|------|
| `scripts/ecs-upload-web.sh` | 本地构建并上传前端 `dist/` |
| `.env.ecs-web.example` | 前端部署配置模板 |
| `.env.ecs` | ECS 构建 mode 环境（API 同源） |
| `server/scripts/ecs-upload.sh` | 本地上传后端 + 触发远端部署 |
| `server/scripts/ecs-deploy.sh` | ECS 上 Podman 构建与启停 |
| `server/scripts/ecs-ensure-running.sh` | 看门狗：检查并拉起停止的容器 |
| `server/scripts/ecs-install-systemd.sh` | 安装 linger + systemd 持久化（一次性） |
| `server/.env.ecs-upload` | SSH 连接配置（本地，不入库） |
| `server/.env.ecs-upload.example` | SSH 配置模板 |
| `server/.env` | 应用运行时配置（部署时同步到 ECS） |
| `server/.env.example` | 应用配置模板 |
| `server/compose.yaml` | Podman Compose 服务定义 |
| `server/Containerfile` | API / Worker 镜像构建 |

---

## 快速检查清单（发版后）

**后端：**

```bash
podman ps -a --filter name=warehouse    # 3 个容器，server 为 healthy
curl http://127.0.0.1:8787/health       # {"ok":true,"db":"up"}
podman logs --tail 20 warehouse-server  # 无 bootstrap failed
```

**前端：**

```bash
ls /var/www/app/dist/index.html
curl -I http://127.0.0.1/               # 200
# 浏览器登录后 /api/auth/me 应 200，非 401
```
