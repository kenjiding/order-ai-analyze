import '../loadEnv'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDb, getDb } from './index'
import { seedDatabase } from './seed'

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function runMigrationsAndSeed(): Promise<void> {
  const db = getDb()
  await migrate(db, { migrationsFolder })
  await seedDatabase()
}

export async function bootstrapDatabase(): Promise<void> {
  try {
    await runMigrationsAndSeed()
    console.log('[db] migrations and seed completed')
  } catch (error) {
    console.error('[db] bootstrap failed', error)
    throw error
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrapDatabase()
    .then(async () => {
      await closeDb()
      process.exit(0)
    })
    .catch(async () => {
      await closeDb()
      process.exit(1)
    })
}
