/**
 * 后端根地址（无末尾斜杠）。跨域请求直连 Node，需在服务端开启 CORS。
 * 可通过环境变量 `VITE_API_BASE` 覆盖，例如生产部署地址。
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE as string | undefined
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (trimmed) return trimmed.replace(/\/$/, '')
  return import.meta.env.MODE === 'production' ? 'https://blil5642k3zzfvythnykvbpbna0iahzu.lambda-url.us-east-1.on.aws' : 'http://127.0.0.1:8787'
}
