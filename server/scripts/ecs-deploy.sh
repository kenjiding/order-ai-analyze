#!/usr/bin/env bash
# 阿里云 ECS 上部署 warehouse-server（Podman / podman compose）
#
# 首次在 ECS 上：
#   1. 安装 Podman 与 compose（Alibaba Cloud Linux 3 示例见下方注释）
#   2. git clone 本仓库，cd server
#   3. cp .env.example .env && vim .env
#   4. ./scripts/ecs-deploy.sh up
#
# 使用 ACR 镜像（可选）：
#   export ACR_REGISTRY=registry.cn-hangzhou.aliyuncs.com/your-ns
#   export ACR_IMAGE=warehouse-server
#   ./scripts/ecs-deploy.sh push    # 本地或 CI 构建并推送
#   ./scripts/ecs-deploy.sh pull-up # ECS 上拉取并启动
#
# Alibaba Cloud Linux 3 安装 Podman（在 ECS 上执行一次）：
#   sudo dnf install -y podman podman-compose
#   # 或较新版本内置 podman compose 子命令：
#   podman compose version

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-warehouse-server:latest}"
# -f 相对当前目录（server/）；COPY 路径相对 BUILD_CONTEXT（仓库根）
CONTAINERFILE="${CONTAINERFILE:-Containerfile}"
BUILD_CONTEXT="${BUILD_CONTEXT:-..}"
ACR_REGISTRY="${ACR_REGISTRY:-}"
ACR_IMAGE="${ACR_IMAGE:-warehouse-server}"
ACR_TAG="${ACR_TAG:-latest}"

require_podman() {
  if ! command -v podman &>/dev/null; then
    echo "未找到 podman，请先安装：sudo dnf install -y podman" >&2
    exit 1
  fi
}

compose() {
  if podman compose version &>/dev/null; then
    podman compose "$@"
  elif command -v podman-compose &>/dev/null; then
    podman-compose "$@"
  else
    echo "需要 podman compose 或 podman-compose，请：sudo dnf install -y podman-compose" >&2
    exit 1
  fi
}

acr_image() {
  if [[ -z "$ACR_REGISTRY" ]]; then
    echo "请设置 ACR_REGISTRY，例如 registry.cn-hangzhou.aliyuncs.com/your-namespace" >&2
    exit 1
  fi
  echo "${ACR_REGISTRY%/}/${ACR_IMAGE}:${ACR_TAG}"
}

ensure_env() {
  if [[ ! -f .env ]]; then
    echo "缺少 server/.env，请先：cp .env.example .env 并填入密钥" >&2
    exit 1
  fi
}

require_podman
cmd="${1:-up}"

case "$cmd" in
  build)
    podman build -t "$IMAGE" -f "$CONTAINERFILE" "$BUILD_CONTEXT"
    ;;
  up)
    ensure_env
    compose up -d --build
    compose ps
    echo ""
    echo "健康检查: curl -sf http://127.0.0.1:${PORT:-8787}/health"
    ;;
  down)
    compose down
    ;;
  restart)
    ensure_env
    # 先构建新镜像；build 失败时旧容器继续运行，不影响线上
    echo "[deploy] 构建镜像..."
    compose build warehouse-server
    echo "[deploy] 重建应用容器（postgres 保持运行，不重启）..."
    # podman-compose 1.x 的 --no-deps 不可靠，会连 postgres 一起 recreate；
    # 用 podman 直接只重建 app 容器，避免数据库短暂不可用。
    if podman container exists warehouse-worker 2>/dev/null; then
      podman stop -t 10 warehouse-worker || true
      podman rm warehouse-worker || true
    fi
    if podman container exists warehouse-server 2>/dev/null; then
      podman stop -t 10 warehouse-server || true
      podman rm warehouse-server || true
    fi
    compose up -d --no-deps warehouse-server warehouse-worker
    compose ps
    echo ""
    _port="${PORT:-8787}"
    echo "[deploy] 等待 health（最多 120s）..."
    _ok=false
    for (( _i=1; _i<=24; _i++ )); do
      if curl -sf "http://127.0.0.1:${_port}/health" >/dev/null 2>&1; then
        _ok=true
        break
      fi
      echo "[deploy] 第 ${_i}/24 次..."
      sleep 5
    done
    if $_ok; then
      echo "[deploy] ok  http://127.0.0.1:${_port}/health"
    else
      echo "[deploy] ⚠ 120s 内未通过 health 检查，最新日志：" >&2
      compose logs --tail=30 warehouse-server >&2
      exit 1
    fi
    ;;
  ensure)
    bash "$ROOT/scripts/ecs-ensure-running.sh"
    compose ps
    ;;
  logs)
    compose logs -f --tail=200
    ;;
  push)
    if [[ -z "$ACR_REGISTRY" ]]; then
      echo "未设置 ACR_REGISTRY，仅本地构建 $IMAGE" >&2
      podman build -t "$IMAGE" -f "$CONTAINERFILE" "$BUILD_CONTEXT"
      exit 0
    fi
    remote="$(acr_image)"
    podman build -t "$IMAGE" -f "$CONTAINERFILE" "$BUILD_CONTEXT"
    podman tag "$IMAGE" "$remote"
    echo "推送 $remote （需先 podman login ${ACR_REGISTRY%%/*}）"
    podman push "$remote"
    ;;
  pull-up)
    ensure_env
    remote="$(acr_image)"
    podman pull "$remote"
    podman tag "$remote" "$IMAGE"
    compose up -d
    compose ps
    ;;
  health)
    curl -sf "http://127.0.0.1:${PORT:-8787}/health" && echo
    ;;
  *)
    echo "用法: $0 {build|up|down|restart|ensure|logs|push|pull-up|health}" >&2
    exit 1
    ;;
esac
