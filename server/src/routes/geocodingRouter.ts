import { Router, type Request, type Response } from 'express'

export const geocodingRouter = Router()

const LOCATIONIQ_SEARCH_URL = 'https://us1.locationiq.com/v1/search'

type GeocodeResult = { displayName: string; lat: number; lng: number }

geocodingRouter.get('/search', async (req: Request, res: Response) => {
  const apiKey = process.env.LOCATIONIQ_API_KEY
  if (!apiKey) {
    res.status(500).json({ ok: false, error: '未配置地理编码服务（LOCATIONIQ_API_KEY）' })
    return
  }
  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.status(400).json({ ok: false, error: '请输入地址' })
    return
  }

  try {
    const url = `${LOCATIONIQ_SEARCH_URL}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&format=json&limit=5`
    const response = await fetch(url)
    // LocationIQ 查不到结果时返回 404 + { error: 'Unable to geocode' }，这不是服务故障，是正常的「没搜到」
    if (response.status === 404) {
      res.json({ ok: true, data: [] })
      return
    }
    if (!response.ok) {
      res.status(502).json({ ok: false, error: '地理编码服务请求失败' })
      return
    }
    const raw = (await response.json()) as unknown
    const list = Array.isArray(raw) ? raw : []
    const results: GeocodeResult[] = []
    for (const item of list) {
      const row = item as Record<string, unknown>
      const lat = Number(row.lat)
      const lng = Number(row.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      results.push({ displayName: String(row.display_name ?? q), lat, lng })
    }
    res.json({ ok: true, data: results })
  } catch {
    res.status(500).json({ ok: false, error: '地理编码请求异常' })
  }
})
