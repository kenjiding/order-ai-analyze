#!/usr/bin/env bash
# 检查 warehouse 三个容器是否在运行；若 Created/Exited 则拉起。
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

need_start=false
for name in "${CONTAINERS[@]}"; do
  if ! podman container exists "$name" 2>/dev/null; then
    echo "[ensure] 缺少容器 $name，将 compose up"
    need_start=true
    continue
  fi
  status="$(podman inspect "$name" --format '{{.State.Status}}' 2>/dev/null || echo missing)"
  if [[ "$status" != "running" ]]; then
    echo "[ensure] $name 状态=$status，尝试 podman start"
    podman start "$name" 2>/dev/null || need_start=true
  fi
done

if $need_start; then
  if [[ -f .env ]]; then
    compose up -d
  else
    echo "[ensure] 缺少 .env，无法 compose up" >&2
    exit 1
  fi
fi

if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "[ensure] ok health=${PORT}"
  exit 0
fi

echo "[ensure] health 失败，compose restart"
if [[ -f .env ]]; then
  compose up -d --force-recreate
  sleep 5
  curl -sf "http://127.0.0.1:${PORT}/health" && echo "[ensure] recovered" && exit 0
fi

echo "[ensure] 仍无法通过 health 检查" >&2
exit 1
