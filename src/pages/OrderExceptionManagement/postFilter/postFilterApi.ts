import { backendFetch } from '../../../api/httpClient'
import { normalizePostFilterConfig } from './defaults'
import type { PostFilterConfig } from './types'

const postFilterApi = '/api/order-exception/post-filter'

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

export async function fetchPostFilterConfig(): Promise<PostFilterConfig | null> {
  const res = await backendFetch(postFilterApi)
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const json = JSON.parse(text) as { config: unknown }
  return json.config ? normalizePostFilterConfig(json.config) : null
}

export async function savePostFilterConfigApi(config: PostFilterConfig): Promise<void> {
  const res = await backendFetch(postFilterApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: config }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
}
