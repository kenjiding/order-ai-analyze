const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/**
 * 将经纬度编码为 geohash 字符串。
 * BOM 预报接口以 geohash 定位，其网站/App 使用 6 位精度。
 */
export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let latMin = -90
  let latMax = 90
  let lngMin = -180
  let lngMax = 180

  let hash = ''
  let bit = 0
  let ch = 0
  let evenBit = true // true=当前处理经度

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2
      if (lng >= mid) {
        ch = (ch << 1) + 1
        lngMin = mid
      } else {
        ch = ch << 1
        lngMax = mid
      }
    } else {
      const mid = (latMin + latMax) / 2
      if (lat >= mid) {
        ch = (ch << 1) + 1
        latMin = mid
      } else {
        ch = ch << 1
        latMax = mid
      }
    }
    evenBit = !evenBit

    if (++bit === 5) {
      hash += BASE32[ch]
      bit = 0
      ch = 0
    }
  }

  return hash
}
