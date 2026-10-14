import { getGlobalImileToken } from './src/feishu/globalImileToken'
import { normalizeImileToken } from './src/imile/shared'
import { fetchScanStatWaybills, groupScanStatWaybills } from './src/imile/scanStatWaybills'

async function main() {
  const userId = '930184b8-c1ee-461e-a0d9-45cc11eeb993'
  const token = normalizeImileToken(await getGlobalImileToken(userId))
  const waybillNos = ['6100726960927', '6100426044686', '6100426288717', '3781061124639', '6100526926008', 'NOT_A_REAL_ONE']
  const res = await fetchScanStatWaybills({ token, waybillNos })
  if (!res.ok) {
    console.error('FAIL', res)
    return
  }
  console.log('hits:', res.hits)
  console.log('groups:', groupScanStatWaybills(waybillNos, res.hits))
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
