import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrderAnalyzeRegressionFixture, RegressionCaseListItem } from './types'

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
)

function sanitizeFixtureId(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) throw new Error('用例 id 不能为空')
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('用例 id 仅允许字母、数字、下划线与连字符')
  }
  return trimmed
}

function fixturePath(id: string): string {
  return path.join(FIXTURES_DIR, `${sanitizeFixtureId(id)}.json`)
}

async function ensureFixturesDir(): Promise<void> {
  await fs.mkdir(FIXTURES_DIR, { recursive: true })
}

function validateFixture(fixture: OrderAnalyzeRegressionFixture): void {
  if (!fixture.orderNo?.trim()) throw new Error('orderNo 不能为空')
  if (!Array.isArray(fixture.tracks) || fixture.tracks.length === 0) {
    throw new Error('tracks 不能为空')
  }
  if (!fixture.expected?.lossScope) throw new Error('expected.lossScope 不能为空')
}

export async function listFixtures(): Promise<RegressionCaseListItem[]> {
  await ensureFixturesDir()
  let names: string[] = []
  try {
    names = await fs.readdir(FIXTURES_DIR)
  } catch {
    return []
  }

  const items: RegressionCaseListItem[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || name === '.gitkeep') continue
    const id = name.slice(0, -5)
    const fixture = await getFixture(id)
    if (!fixture) continue
    items.push({
      id: fixture.id,
      orderNo: fixture.orderNo,
      capturedAt: fixture.capturedAt,
      expected: fixture.expected,
      trackCount: fixture.tracks.length,
      interceptLogCount: fixture.interceptLogs.length,
    })
  }

  return items.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
}

export async function getFixture(id: string): Promise<OrderAnalyzeRegressionFixture | null> {
  try {
    const raw = await fs.readFile(fixturePath(id), 'utf8')
    return JSON.parse(raw) as OrderAnalyzeRegressionFixture
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function upsertFixture(
  fixture: OrderAnalyzeRegressionFixture
): Promise<OrderAnalyzeRegressionFixture> {
  await ensureFixturesDir()
  const id = sanitizeFixtureId(fixture.id || fixture.orderNo)
  const normalized: OrderAnalyzeRegressionFixture = {
    ...fixture,
    id,
    orderNo: String(fixture.orderNo).trim(),
    capturedAt: fixture.capturedAt || new Date().toISOString(),
    interceptLogs: Array.isArray(fixture.interceptLogs) ? fixture.interceptLogs : [],
  }
  validateFixture(normalized)
  await fs.writeFile(fixturePath(id), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

export async function deleteFixture(id: string): Promise<boolean> {
  try {
    await fs.unlink(fixturePath(id))
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}

export async function listAllFixtureRecords(): Promise<OrderAnalyzeRegressionFixture[]> {
  const items = await listFixtures()
  const fixtures: OrderAnalyzeRegressionFixture[] = []
  for (const item of items) {
    const f = await getFixture(item.id)
    if (f) fixtures.push(f)
  }
  return fixtures
}
