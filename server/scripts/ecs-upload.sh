#!/usr/bin/env bash
# 将 server 目录同步到阿里云 ECS，并可选在远端执行 ecs-deploy.sh
#
# 首次使用：
#   cp .env.ecs-upload.example .env.ecs-upload
#   vim .env.ecs-upload          # 填入 ECS_HOST / ECS_USER / ECS_PASSWORD 等
#   ./scripts/ecs-upload.sh
#
# 常用：
#   ./scripts/ecs-upload.sh              # 仅上传代码
#   ./scripts/ecs-upload.sh --deploy     # 上传代码 + 本地 .env，并在 ECS restart 重建
#   ./scripts/ecs-upload.sh --with-env   # 仅上传时附带本地 .env（不部署）
#
# 环境变量（也可写在 server/.env.ecs-upload）：
#   ECS_HOST          默认 47.83.235.214
#   ECS_USER          默认 aus-user
#   ECS_PASSWORD      密码登录时需设置，并安装 sshpass
#   ECS_SSH_KEY       SSH 私钥路径（推荐，设置后优先于密码）
#   ECS_REMOTE_DIR    远端目录，默认 ~/warehouse-server
#   ECS_SSH_PORT      默认 22

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONFIG_FILE="${ECS_UPLOAD_CONFIG:-$ROOT/.env.ecs-upload}"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$CONFIG_FILE"
  set +a
fi

ECS_HOST="${ECS_HOST:-47.83.235.214}"
ECS_USER="${ECS_USER:-aus-user}"
ECS_REMOTE_DIR="${ECS_REMOTE_DIR:-~/warehouse-server}"
ECS_SSH_PORT="${ECS_SSH_PORT:-22}"

WITH_ENV=false
DEPLOY=false

usage() {
  cat <<'EOF'
用法: ecs-upload.sh [选项]

选项:
  --with-env   上传时附带本地 .env（不部署时也可用）
  --deploy     上传代码与本地 .env，并在 ECS 执行 ecs-deploy.sh restart
  -h, --help   显示帮助

认证（二选一）:
  1. SSH 密钥（推荐）: 在 .env.ecs-upload 设置 ECS_SSH_KEY=~/.ssh/id_rsa
  2. 密码: 设置 ECS_PASSWORD，并安装 sshpass
     macOS: brew install hudochenkov/sshpass/sshpass
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-env) WITH_ENV=true; shift ;;
    --deploy) DEPLOY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

# --deploy 时检测 schema.ts 与 migrations/ 是否有未提交变更
if $DEPLOY; then
  schema_dirty=$(git -C "$ROOT" diff HEAD -- src/db/schema.ts 2>/dev/null)
  migrations_dirty=$(git -C "$ROOT" status --porcelain src/db/migrations/ 2>/dev/null)
  if [[ -n "$schema_dirty" || -n "$migrations_dirty" ]]; then
    echo "" >&2
    echo "❌ 部署中止：数据库文件有未提交的变更。" >&2
    echo "" >&2
    [[ -n "$schema_dirty" ]]     && echo "  • schema.ts 有未提交的改动" >&2
    [[ -n "$migrations_dirty" ]] && echo "  • migrations/ 有未提交的文件" >&2
    echo "" >&2
    echo "请先执行：" >&2
    echo "  cd server && npm run db:generate   # 如果改了 schema.ts" >&2
    echo "  git add src/db/                    # 暂存迁移文件" >&2
    echo "  git commit -m 'feat: 迁移说明'" >&2
    echo "  pnpm ecs:deploy" >&2
    echo "" >&2
    exit 1
  fi
fi

SSH_BASE_OPTS=(
  -p "$ECS_SSH_PORT"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
)
# scp 端口用大写 -P；-p 在 scp 中表示保留时间戳
SCP_BASE_OPTS=(
  -P "$ECS_SSH_PORT"
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
      echo "或改用 SSH 密钥: 在 .env.ecs-upload 设置 ECS_SSH_KEY" >&2
      exit 1
    fi
    sshpass -p "$ECS_PASSWORD" ssh "${SSH_BASE_OPTS[@]}" "${ECS_USER}@${ECS_HOST}" "$@"
  else
    ssh "${SSH_BASE_OPTS[@]}" "${ECS_USER}@${ECS_HOST}" "$@"
  fi
}

run_scp() {
  local src="$1"
  local dest="$2"
  if [[ -n "${ECS_SSH_KEY:-}" ]]; then
    scp "${SCP_BASE_OPTS[@]}" -i "$ECS_SSH_KEY" "$src" "${ECS_USER}@${ECS_HOST}:${dest}"
  elif [[ -n "${ECS_PASSWORD:-}" ]]; then
    sshpass -p "$ECS_PASSWORD" scp "${SCP_BASE_OPTS[@]}" "$src" "${ECS_USER}@${ECS_HOST}:${dest}"
  else
    scp "${SCP_BASE_OPTS[@]}" "$src" "${ECS_USER}@${ECS_HOST}:${dest}"
  fi
}

upload_via_tar() {
  echo "==> 同步 server 文件（tar + ssh，不依赖远端 rsync）"
  # COPYFILE_DISABLE 避免 macOS 扩展属性在 Linux 解压时报错
  COPYFILE_DISABLE=1 tar czf - \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude 'job-artifacts' \
    --exclude '*.log' \
    --exclude 'pnpm-debug.log*' \
    --exclude '.env' \
    --exclude '.env.*' \
    -C "$ROOT" . \
  | run_ssh "mkdir -p ${ECS_REMOTE_DIR} && tar xzf - -C ${ECS_REMOTE_DIR} 2>/dev/null"
}

# 前后端共用模块（如 rankingScore）；镜像 build context 为 server 的父目录
upload_shared_via_tar() {
  local shared_dir="$ROOT/../shared"
  if [[ ! -d "$shared_dir" ]]; then
    echo "缺少 shared/ 目录（$shared_dir），容器无法解析 ../../../shared 导入" >&2
    exit 1
  fi
  local remote_parent remote_shared
  remote_parent="$(dirname "${ECS_REMOTE_DIR}")"
  remote_shared="${remote_parent}/shared"
  echo "==> 同步 shared/ → ${remote_shared}"
  COPYFILE_DISABLE=1 tar czf - -C "$(cd "$shared_dir/.." && pwd)" shared \
  | run_ssh "mkdir -p ${remote_parent} && tar xzf - -C ${remote_parent} 2>/dev/null"
}

echo "==> 目标: ${ECS_USER}@${ECS_HOST}:${ECS_REMOTE_DIR}"

echo "==> 创建远端目录"
run_ssh "mkdir -p ${ECS_REMOTE_DIR}"

upload_via_tar
upload_shared_via_tar

SHOULD_UPLOAD_ENV=false
if $WITH_ENV || $DEPLOY; then
  SHOULD_UPLOAD_ENV=true
fi

if $SHOULD_UPLOAD_ENV; then
  if [[ ! -f "$ROOT/.env" ]]; then
    echo "本地缺少 server/.env，部署需要环境变量配置" >&2
    echo "请先：cp .env.example .env 并填入密钥，或使用 --with-env 仅在上传时附带" >&2
    exit 1
  fi
  if $DEPLOY && ! $WITH_ENV; then
    echo "==> 上传 .env（--deploy 自动同步本地配置）"
  else
    echo "==> 上传 .env"
  fi
  run_scp "$ROOT/.env" "${ECS_REMOTE_DIR}/.env"
elif [[ -f "$ROOT/.env" ]]; then
  echo "==> 跳过 .env（仅上传代码；部署请加 --deploy 或显式 --with-env）"
else
  echo "==> 跳过 .env（远端请自行维护 .env）"
fi

if $DEPLOY; then
  echo "==> 远端部署: ecs-deploy.sh restart"
  run_ssh "cd ${ECS_REMOTE_DIR} && chmod +x scripts/*.sh && ./scripts/ecs-deploy.sh restart"
else
  echo ""
  echo "上传完成。登录 ECS 后启动："
  echo "  ssh ${ECS_USER}@${ECS_HOST}"
  echo "  cd ${ECS_REMOTE_DIR}"
  echo "  cp .env.example .env && vim .env   # 若尚未配置"
  echo "  ./scripts/ecs-deploy.sh up"
  echo ""
  echo "或本地一键部署: ./scripts/ecs-upload.sh --deploy"
fi
