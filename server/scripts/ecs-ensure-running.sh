#!/usr/bin/env bash
# 检查 warehouse 三个容器是否在运行；若异常则 compose up -d 拉起。
# 可配合 systemd timer 或 cron 使用。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8787}"
CONTAINERS=(warehouse-postgres warehouse-server warehouse-worker)

compose() {
  if podman compose version &>/dev/null; then
    podman compose "$@"
  else
    podman-compose "$@"
  fi
}

wait_for_health() {
  local max_attempts="${ENSURE_HEALTH_WAIT_ATTEMPTS:-18}"
  local attempt
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
      return 0
    fi
    echo "[ensure] 等待 health (${attempt}/${max_attempts})..."
    sleep 5
  done
  return 1
}

# 检查是否需要 compose up：任何容器不在 running，或 postgres 不健康
need_start=false
for name in "${CONTAINERS[@]}"; do
  status="$(podman inspect "$name" --format '{{.State.Status}}' 2>/dev/null || echo missing)"
  if [[ "$status" != "running" ]]; then
    echo "[ensure] $name 状态=$status"
    need_start=true
  fi
done

# 即使所有容器都 running，也检查 postgres 健康状态
if ! $need_start; then
  pg_health="$(podman inspect warehouse-postgres --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
  if [[ "$pg_health" != "healthy" ]]; then
    echo "[ensure] postgres health=$pg_health"
    need_start=true
  fi
fi

if $need_start; then
  if [[ ! -f .env ]]; then
    echo "[ensure] 缺少 .env，无法 compose up" >&2
    exit 1
  fi
  echo "[ensure] compose up -d"
  compose up -d
fi

if wait_for_health; then
  echo "[ensure] ok health=${PORT}"
  exit 0
fi

echo "[ensure] health 检查失败，最新日志：" >&2
podman logs --tail=30 warehouse-server 2>&1 | sed 's/^/[server] /' >&2
echo "[ensure] 请手动检查: podman ps && podman logs warehouse-server" >&2
exit 1
