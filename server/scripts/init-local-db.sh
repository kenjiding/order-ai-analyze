#!/usr/bin/env bash
# 在本机已有 Postgres（默认 :5432）上创建 warehouse 用户与数据库（幂等）。
# 本地 Docker 开发：复用正在运行的 Postgres 容器，无需再起 warehouse-postgres。
#
# 用法（在 server 目录）：
#   cp .env.example .env
#   pnpm db:init          # 自动探测 publish=5432 的容器，用 postgres 超管执行
#   pnpm db:migrate
#
# 若超管账号不是 postgres，可设置：
#   LOCAL_PG_ADMIN_URL=postgresql://postgres:yourpass@127.0.0.1:5432/postgres pnpm db:init
#   或 LOCAL_PG_CONTAINER=pet-house-postgres-1 LOCAL_PG_ADMIN_USER=postgres pnpm db:init

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

APP_USER="${POSTGRES_USER:-warehouse}"
APP_PASSWORD="${POSTGRES_PASSWORD:-warehouse}"
APP_DB="${POSTGRES_DB:-warehouse}"
ADMIN_USER="${LOCAL_PG_ADMIN_USER:-postgres}"

run_psql() {
  docker exec -i "$1" psql -U "$ADMIN_USER" -v ON_ERROR_STOP=1 -d postgres
}

SQL=$(cat <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${APP_USER}') THEN
    CREATE ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
  ELSE
    ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASSWORD}';
  END IF;
END \$\$;

SELECT 'CREATE DATABASE ${APP_DB} OWNER ${APP_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${APP_DB}')\\gexec

GRANT ALL PRIVILEGES ON DATABASE ${APP_DB} TO ${APP_USER};
EOF
)

if [[ -n "${LOCAL_PG_ADMIN_URL:-}" ]]; then
  if ! command -v psql &>/dev/null; then
    echo "未找到 psql，请安装 PostgreSQL 客户端或改用 LOCAL_PG_CONTAINER。" >&2
    exit 1
  fi
  echo "[db:init] via LOCAL_PG_ADMIN_URL"
  printf '%s\n' "$SQL" | psql "$LOCAL_PG_ADMIN_URL"
elif [[ -n "${LOCAL_PG_CONTAINER:-}" ]]; then
  echo "[db:init] docker exec ${LOCAL_PG_CONTAINER} (user=${ADMIN_USER})"
  printf '%s\n' "$SQL" | run_psql "$LOCAL_PG_CONTAINER"
else
  CONTAINER="$(docker ps --filter "publish=5432" --format '{{.Names}}' | head -1 || true)"
  if [[ -z "$CONTAINER" ]]; then
    echo "未找到监听 5432 的 Postgres 容器。" >&2
    echo "请先启动本机 Postgres，或设置 LOCAL_PG_ADMIN_URL / LOCAL_PG_CONTAINER。" >&2
    exit 1
  fi
  echo "[db:init] docker exec ${CONTAINER} (user=${ADMIN_USER})"
  printf '%s\n' "$SQL" | run_psql "$CONTAINER"
fi

echo "[db:init] ready: postgresql://${APP_USER}:***@127.0.0.1:5432/${APP_DB}"
