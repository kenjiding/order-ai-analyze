import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Job } from '../db/schema'
import { readJobArtifactDir, readJobArtifactTtlHours } from './config'

function resolveArtifactRoot(): string {
  return path.resolve(readJobArtifactDir())
}

export function buildArtifactRelPath(job: Pick<Job, 'id' | 'type' | 'regionCode'>): string {
  const region = job.regionCode?.trim() || '_'
  const safeType = job.type.replace(/[^\w.-]+/g, '_')
  return path.join(region, safeType, `${job.id}.json`)
}

export function resolveArtifactAbsPath(relPath: string): string {
  const root = resolveArtifactRoot()
  const abs = path.resolve(root, relPath)
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
    throw new Error('invalid artifact path')
  }
  return abs
}

export function computeArtifactExpiresAt(from = new Date()): Date {
  const hours = readJobArtifactTtlHours()
  return new Date(from.getTime() + hours * 60 * 60 * 1000)
}

export async function writeJobArtifactJson(job: Pick<Job, 'id' | 'type' | 'regionCode'>, data: unknown): Promise<string> {
  const relPath = buildArtifactRelPath(job)
  const absPath = resolveArtifactAbsPath(relPath)
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return relPath
}

export async function readJobArtifactJson(relPath: string): Promise<unknown> {
  const absPath = resolveArtifactAbsPath(relPath)
  const text = await readFile(absPath, 'utf8')
  return JSON.parse(text) as unknown
}

export function isArtifactExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() <= now.getTime()
}

export function createArtifactWriter(job: Pick<Job, 'id' | 'type' | 'regionCode'>): {
  writeJson: (data: unknown) => Promise<string>
} {
  return {
    writeJson: (data) => writeJobArtifactJson(job, data),
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const out: string[] = []
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)))
      continue
    }
    if (entry.isFile()) out.push(abs)
  }
  return out
}

/** 按 mtime 与 TTL 清理 artifact 目录中的过期文件 */
export async function cleanupExpiredArtifacts(now = new Date()): Promise<number> {
  const root = resolveArtifactRoot()
  const ttlMs = readJobArtifactTtlHours() * 60 * 60 * 1000
  const files = await walkFiles(root)
  let removed = 0

  for (const file of files) {
    const info = await stat(file)
    if (now.getTime() - info.mtimeMs <= ttlMs) continue
    await rm(file, { force: true })
    removed += 1
  }

  return removed
}
