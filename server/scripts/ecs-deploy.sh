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
CONTAINERFILE="${CONTAINERFILE:-Containerfile}"
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
    podman build -t "$IMAGE" -f "$CONTAINERFILE" .
    ;;
  up)
    ensure_env
    compose --profile stack up -d --build
    compose --profile stack ps
    echo ""
    echo "健康检查: curl -sf http://127.0.0.1:${PORT:-8787}/health"
    ;;
  down)
    compose --profile stack down
    ;;
  restart)
    ensure_env
    compose --profile stack up -d --build --force-recreate
    ;;
  logs)
    compose --profile stack logs -f --tail=200
    ;;
  push)
    if [[ -z "$ACR_REGISTRY" ]]; then
      echo "未设置 ACR_REGISTRY，仅本地构建 $IMAGE" >&2
      podman build -t "$IMAGE" -f "$CONTAINERFILE" .
      exit 0
    fi
    remote="$(acr_image)"
    podman build -t "$IMAGE" -f "$CONTAINERFILE" .
    podman tag "$IMAGE" "$remote"
    echo "推送 $remote （需先 podman login ${ACR_REGISTRY%%/*}）"
    podman push "$remote"
    ;;
  pull-up)
    ensure_env
    remote="$(acr_image)"
    podman pull "$remote"
    podman tag "$remote" "$IMAGE"
    compose --profile stack up -d
    compose --profile stack ps
    ;;
  health)
    curl -sf "http://127.0.0.1:${PORT:-8787}/health" && echo
    ;;
  *)
    echo "用法: $0 {build|up|down|restart|logs|push|pull-up|health}" >&2
    exit 1
    ;;
esac
