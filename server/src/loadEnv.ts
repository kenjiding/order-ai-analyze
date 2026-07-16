import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverSrcDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(serverSrcDir, '..')

// 服务端只读 server/ 下环境文件；仓库根 .env 留给 Vite 前端。
// 分层：.env（可随 --deploy 同步到 ECS）→ .env.local（仅本机覆盖，不上传）。
config({ path: resolve(serverRoot, '.env'), override: true })
const localEnvPath = resolve(serverRoot, '.env.local')
if (existsSync(localEnvPath)) {
  config({ path: localEnvPath, override: true })
}
