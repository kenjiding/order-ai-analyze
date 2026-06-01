/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'warehouse-server',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
    }
  },
  async run() {
    const { existsSync, readFileSync } = await import('node:fs')
    const { dirname, resolve } = await import('node:path')
    const { parse } = await import('dotenv')

    /** 从若干起点向上查找 .env（SST 运行 config 时 import.meta.dirname 常在 .sst 下，不能单靠一层 ../） */
    function findEnvFile(): string | undefined {
      const starts = [
        process.cwd(),
        import.meta.dirname,
        resolve(import.meta.dirname, '..'),
      ]
      for (const raw of starts) {
        let dir = resolve(raw)
        for (let i = 0; i < 12; i++) {
          const candidate = resolve(dir, '.env')
          if (existsSync(candidate)) return candidate
          const parent = dirname(dir)
          if (parent === dir) break
          dir = parent
        }
      }
      return undefined
    }

    let envVars: Record<string, string> = {}
    const envPath = findEnvFile()
    if (envPath) {
      envVars = parse(readFileSync(envPath, 'utf-8'))
    } else {
      console.warn(
        '[sst] 未找到 .env（已从 cwd 与 config 目录向上查找），跳过注入',
      )
    }

    const server = new sst.aws.Function('Server', {
      handler: 'src/handler.handler',
      runtime: 'nodejs22.x',
      memory: '512 MB',
      timeout: '300 seconds',
      url: { cors: false },
      environment: envVars,
    })

    return {
      url: server.url,
    }
  },
})
