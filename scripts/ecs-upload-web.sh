#!/usr/bin/env bash
# 构建并上传前端静态资源到阿里云 ECS（Nginx 托管）
#
# 前置：
#   1. server/.env.ecs-upload 已配置 SSH（与后端上传共用）
#   2. ECS 上 Nginx 已配置 root 与 /api 反代（见 /etc/nginx/conf.d/app.conf）
#   3. aus-user 对目标目录有写权限，或已配置无密码 sudo
#
# 常用：
#   pnpm ecs:upload-web              # 构建（--mode ecs）+ 上传
#   pnpm ecs:deploy-web              # 构建 + 上传 + reload nginx
#   ./scripts/ecs-upload-web.sh --no-build
#
# 配置（优先级：环境变量 > .env.ecs-web > server/.env.ecs-upload）：
#   ECS_WEB_REMOTE_DIR   远端静态目录，默认 /var/www/app/dist
#   ECS_WEB_USE_SUDO     auto|true|false，/var/www 下默认 auto 启用 sudo
#   ECS_WEB_BUILD_MODE   Vite 构建 mode，默认 ecs（使用 .env.ecs，API 同源）

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/server/.env.ecs-upload" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/server/.env.ecs-upload"
  set +a
fi

if [[ -f "$ROOT/.env.ecs-web" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/.env.ecs-web"
  set +a
fi

ECS_HOST="${ECS_HOST:-47.83.235.214}"
ECS_USER="${ECS_USER:-aus-user}"
ECS_SSH_PORT="${ECS_SSH_PORT:-22}"
ECS_WEB_REMOTE_DIR="${ECS_WEB_REMOTE_DIR:-/var/www/app/dist}"
ECS_WEB_BUILD_MODE="${ECS_WEB_BUILD_MODE:-ecs}"
ECS_WEB_USE_SUDO="${ECS_WEB_USE_SUDO:-auto}"

SKIP_BUILD=false
RELOAD_NGINX=false

usage() {
  cat <<'EOF'
用法: ecs-upload-web.sh [选项]

选项:
  --no-build       跳过 pnpm build，直接上传已有 dist/
  --reload-nginx   上传后执行 sudo nginx -t && sudo systemctl reload nginx
  -h, --help       显示帮助

配置: .env.ecs-web（可选）、server/.env.ecs-upload（SSH）
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) SKIP_BUILD=true; shift ;;
    --reload-nginx) RELOAD_NGINX=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

resolve_use_sudo() {
  case "$ECS_WEB_USE_SUDO" in
    true|1|yes) echo true ;;
    false|0|no) echo false ;;
    auto)
      if [[ "$ECS_WEB_REMOTE_DIR" == /var/www/* ]]; then
        echo true
      else
        echo false
      fi
      ;;
    *)
      echo "ECS_WEB_USE_SUDO 无效: $ECS_WEB_USE_SUDO（可用 auto|true|false）" >&2
      exit 1
      ;;
  esac
}

USE_SUDO="$(resolve_use_sudo)"

SSH_BASE_OPTS=(
  -p "$ECS_SSH_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
)

run_ssh() {
  if [[ -n "${ECS_SSH_KEY:-}" ]]; then
    ssh "${SSH_BASE_OPTS[@]}" -i "$ECS_SSH_KEY" "${ECS_USER}@${ECS_HOST}" "$@"
  elif [[ -n "${ECS_PASSWORD:-}" ]]; then
    if ! command -v sshpass &>/dev/null; then
      echo "已设置 ECS_PASSWORD 但未找到 sshpass。" >&2
      echo "安装: brew install hudochenkov/sshpass/sshpass" >&2
      exit 1
    fi
    sshpass -p "$ECS_PASSWORD" ssh "${SSH_BASE_OPTS[@]}" "${ECS_USER}@${ECS_HOST}" "$@"
  else
    ssh "${SSH_BASE_OPTS[@]}" "${ECS_USER}@${ECS_HOST}" "$@"
  fi
}

remote_prepare_and_extract() {
  local dir="$1"
  local extract_cmd="tar xzf - --warning=no-unknown-keyword -C ${dir} 2>/dev/null || tar xzf - -C ${dir}"
  if $USE_SUDO; then
    run_ssh "sudo mkdir -p ${dir} && sudo find ${dir} -mindepth 1 -maxdepth 1 -exec rm -rf {} + && sudo ${extract_cmd}"
  else
    run_ssh "mkdir -p ${dir} && find ${dir} -mindepth 1 -maxdepth 1 -exec rm -rf {} + && ${extract_cmd}"
  fi
}

if ! $SKIP_BUILD; then
  echo "==> 构建前端（mode=${ECS_WEB_BUILD_MODE}，API 同源 /api）"
  pnpm build --mode "$ECS_WEB_BUILD_MODE"
else
  echo "==> 跳过构建，使用现有 dist/"
fi

if [[ ! -d "$ROOT/dist" ]] || [[ -z "$(ls -A "$ROOT/dist" 2>/dev/null || true)" ]]; then
  echo "dist/ 为空或不存在，请先执行 pnpm build" >&2
  exit 1
fi

echo "==> 目标: ${ECS_USER}@${ECS_HOST}:${ECS_WEB_REMOTE_DIR}"
if $USE_SUDO; then
  echo "==> 远端写入: sudo（目录在 /var/www 下）"
fi

echo "==> 上传 dist/（tar + ssh）"
COPYFILE_DISABLE=1 tar czf - -C "$ROOT/dist" . | remote_prepare_and_extract "$ECS_WEB_REMOTE_DIR"

if $RELOAD_NGINX; then
  echo "==> 重载 Nginx"
  run_ssh "sudo nginx -t && sudo systemctl reload nginx"
fi

echo ""
echo "上传完成。"
echo "访问: http://${ECS_HOST}/  （/api → 127.0.0.1:8787）"
echo "若 80 端口无法访问，请检查 ECS 安全组是否放行 HTTP。"
