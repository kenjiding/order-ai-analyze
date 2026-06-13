import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let client: ReturnType<typeof postgres> | null = null
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDatabaseUrl(): string {
  const url = String(process.env.DATABASE_URL ?? '').trim()
  if (!url) {
    throw new Error('DATABASE_URL is not configured')
  }
  return url
}

export function getDb() {
  if (!dbInstance) {
    client = postgres(getDatabaseUrl(), { max: 10 })
    dbInstance = drizzle(client, { schema })
  }
  return dbInstance
}

export async function pingDatabase(): Promise<boolean> {
  try {
    const db = getDb()
    await db.execute(sql`SELECT 1`)
    return true
  } catch {
    return false
  }
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end()
    client = null
    dbInstance = null
  }
}

export { schema }
