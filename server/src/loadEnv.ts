import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverSrcDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(serverSrcDir, '..')
const repoRoot = resolve(serverRoot, '..')

// 本地开发时让 .env 覆盖已在 shell 中 export 的同名变量（仍保持 server/.env 覆盖仓库根 .env）。
config({ path: resolve(repoRoot, '.env'), override: true })
config({ path: resolve(serverRoot, '.env'), override: true })
