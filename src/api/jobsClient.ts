import { backendFetch } from './httpClient'

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type PublicJob = {
  id: string
  type: string
  status: JobStatus
  payload: Record<string, unknown>
  progress: Record<string, unknown>
  error: string | null
  artifactPath: string | null
  artifactExpiresAt: string | null
  attemptCount: number
  maxAttempts: number
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const parsed = JSON.parse(text) as { error?: string }
    return parsed.error || `HTTP ${res.status}`
  } catch {
    return text || `HTTP ${res.status}`
  }
}

export async function listJobs(params?: { type?: string; limit?: number }): Promise<{ jobs: PublicJob[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const res = await backendFetch(`/api/jobs?${qs.toString()}`, {
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { jobs: PublicJob[]; total: number }
}

export async function deleteJobApi(jobId: string): Promise<void> {
  const res = await backendFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(await readHttpError(res, text))
  }
}

export async function getJobById(jobId: string): Promise<PublicJob> {
  const res = await backendFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return (JSON.parse(text) as { job: PublicJob }).job
}

export async function getJobArtifact<T>(jobId: string): Promise<T> {
  const res = await backendFetch(`/api/jobs/${encodeURIComponent(jobId)}/artifact`, {
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return (JSON.parse(text) as { artifact: T }).artifact
}

export async function cancelJobApi(jobId: string): Promise<PublicJob> {
  const res = await backendFetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return (JSON.parse(text) as { job: PublicJob }).job
}
