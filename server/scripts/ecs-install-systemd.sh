#!/usr/bin/env bash
# 在 ECS 上安装用户级 systemd，避免 SSH 断开后 rootless Podman 容器被回收。
#
# 一次性执行（需 aus-user 登录）：
#   ./scripts/ecs-install-systemd.sh
#
# 会做：
#   1. sudo loginctl enable-linger aus-user
#   2. 安装 warehouse-app.service（开机/登录后拉起 compose）
#   3. 安装 warehouse-watchdog.timer（每 5 分钟健康检查）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME="$(id -un)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$UNIT_DIR"

if [[ "$(loginctl show-user "$USER_NAME" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  echo "==> 启用 linger（用户登出后仍保持 systemd user 会话）"
  sudo loginctl enable-linger "$USER_NAME"
fi

COMPOSE_BIN="$(command -v podman-compose || true)"
if [[ -z "$COMPOSE_BIN" ]]; then
  echo "未找到 podman-compose" >&2
  exit 1
fi

cat >"$UNIT_DIR/warehouse-app.service" <<EOF
[Unit]
Description=Warehouse Podman Compose Stack
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT}
ExecStart=${COMPOSE_BIN} up -d
ExecStop=${COMPOSE_BIN} down
TimeoutStartSec=300
TimeoutStopSec=120

[Install]
WantedBy=default.target
EOF

cat >"$UNIT_DIR/warehouse-watchdog.service" <<EOF
[Unit]
Description=Warehouse stack health watchdog

[Service]
Type=oneshot
WorkingDirectory=${ROOT}
ExecStart=${ROOT}/scripts/ecs-ensure-running.sh
EOF

cat >"$UNIT_DIR/warehouse-watchdog.timer" <<EOF
[Unit]
Description=Run warehouse watchdog every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

chmod +x "$ROOT/scripts/ecs-ensure-running.sh"

systemctl --user daemon-reload
systemctl --user enable --now warehouse-app.service
systemctl --user enable --now warehouse-watchdog.timer

echo ""
echo "已安装："
systemctl --user status warehouse-app.service --no-pager || true
echo ""
systemctl --user list-timers warehouse-watchdog.timer --no-pager || true
echo ""
echo "Linger=$(loginctl show-user "$USER_NAME" -p Linger --value)"
