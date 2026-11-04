import '../loadEnv'
import { closeDb } from '../db'
import {
  createFeishuOpenApiKey,
  listFeishuOpenApiKeys,
  setFeishuOpenApiKeyDisabled,
} from '../feishu/feishuOpenApiKeyRepository'

/**
 * 飞书推送开放 API 的 key 管理 CLI（没有管理页面，低频操作走命令行即可）：
 *   tsx src/scripts/manageFeishuOpenApiKey.ts create "外部团队A"
 *   tsx src/scripts/manageFeishuOpenApiKey.ts list
 *   tsx src/scripts/manageFeishuOpenApiKey.ts revoke <id>
 */
async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2)

  if (cmd === 'create') {
    if (!arg?.trim()) throw new Error('用法: create "<名称>"')
    const key = await createFeishuOpenApiKey(arg.trim())
    console.log(`已创建，token 只打印这一次，请立即保存：\n${key.token}`)
    return
  }

  if (cmd === 'list') {
    const keys = await listFeishuOpenApiKeys()
    if (!keys.length) {
      console.log('暂无 key')
      return
    }
    for (const k of keys) {
      console.log(
        `${k.id}  ${k.name}  ${k.isDisabled ? '已禁用' : '启用中'}  创建于 ${k.createdAt.toISOString()}  最近使用 ${k.lastUsedAt?.toISOString() ?? '从未'}`,
      )
    }
    return
  }

  if (cmd === 'revoke') {
    if (!arg?.trim()) throw new Error('用法: revoke <id>')
    await setFeishuOpenApiKeyDisabled(arg.trim(), true)
    console.log('已禁用')
    return
  }

  throw new Error('用法: create "<名称>" | list | revoke <id>')
}

main()
  .then(async () => {
    await closeDb()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err)
    await closeDb()
    process.exit(1)
  })
