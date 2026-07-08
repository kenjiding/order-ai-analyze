import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverSrcDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(serverSrcDir, '..')

// 服务端环境变量只从 server/.env 读取；仓库根 .env 保留给 Vite 前端使用。
config({ path: resolve(serverRoot, '.env'), override: true })
