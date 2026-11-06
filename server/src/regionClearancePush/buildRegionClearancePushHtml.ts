/**
 * 区域大盘清货数据推送的截图卡片 HTML（替代原飞书富文本卡片）。
 * 设计已与用户在 Artifact 里确认：矩阵台账——大区合计行 + 站点明细行，三列(昨日/今日/今日库存)，
 * 固定一套明亮配色，不跟随系统深色模式（截图要的是稳定外观，不是跟随查看者的主题）。
 * @see https://claude.ai/artifact/RAmy8sJdFc6VEGebkjWGmE
 */
import type { BrandCount, DispatchDeliveredStat, InventoryStat } from './aggregate'
import type { RegionClearanceSnapshot, RegionStationEntry } from './types'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const EMPTY_BRAND: BrandCount = { temu: 0, shein: 0, other: 0 }

/** Temu/Shein/其他 的小计行，展示在对应指标 mrow 下面 */
function brandLine(brand: BrandCount): string {
  return `<div class="mbrand">Temu <b class="num">${brand.temu}</b> · Shein <b class="num">${brand.shein}</b> · 其他 <b class="num">${brand.other}</b></div>`
}

/** 跟上次推送的差值；没有上次快照（首次推送）时不展示。上升红色、下降绿色（中文业务报表惯例） */
function deltaSpan(current: number, previous: number | undefined): string {
  if (previous === undefined) return ''
  const d = current - previous
  if (d === 0) return `<span class="delta delta-flat">±0</span>`
  const cls = d > 0 ? 'delta-up' : 'delta-down'
  return `<span class="delta ${cls}">${d > 0 ? '↑' : '↓'}${Math.abs(d)}</span>`
}

function dispatchDeliveredCell(
  stat: { dispatch: number; delivered: number; drivers: number; dispatchBrand: BrandCount; deliveredBrand: BrandCount },
  prev?: { dispatch: number; delivered: number; drivers: number },
): string {
  return `<div class="mcell">
    <div class="mrow"><span class="mdot" style="background:var(--dispatch)"></span><span class="mlabel">派件</span><span class="mval num">${stat.dispatch}</span>${deltaSpan(stat.dispatch, prev?.dispatch)}</div>
    ${brandLine(stat.dispatchBrand)}
    <div class="mrow"><span class="mdot" style="background:var(--delivered)"></span><span class="mlabel">签收</span><span class="mval num">${stat.delivered}</span>${deltaSpan(stat.delivered, prev?.delivered)}</div>
    ${brandLine(stat.deliveredBrand)}
    <div class="mrow"><span class="mdot" style="background:var(--drivers)"></span><span class="mlabel">司机</span><span class="mval num">${stat.drivers}</span>${deltaSpan(stat.drivers, prev?.drivers)}</div>
  </div>`
}

function inventoryCell(
  stat: { inWarehouse: number; outWarehouse: number; total: number; inWarehouseBrand: BrandCount; outWarehouseBrand: BrandCount },
  prev?: { inWarehouse: number; outWarehouse: number; total: number },
): string {
  const totalBrand: BrandCount = {
    temu: stat.inWarehouseBrand.temu + stat.outWarehouseBrand.temu,
    shein: stat.inWarehouseBrand.shein + stat.outWarehouseBrand.shein,
    other: stat.inWarehouseBrand.other + stat.outWarehouseBrand.other,
  }
  return `<div class="mcell">
    <div class="mrow"><span class="mdot" style="background:var(--stock-in)"></span><span class="mlabel">仓内</span><span class="mval num">${stat.inWarehouse}</span>${deltaSpan(stat.inWarehouse, prev?.inWarehouse)}</div>
    ${brandLine(stat.inWarehouseBrand)}
    <div class="mrow"><span class="mdot" style="background:var(--stock-out)"></span><span class="mlabel">仓外</span><span class="mval num">${stat.outWarehouse}</span>${deltaSpan(stat.outWarehouse, prev?.outWarehouse)}</div>
    ${brandLine(stat.outWarehouseBrand)}
    <div class="mrow mrow-total"><span class="mlabel">合计</span><span class="mval num">${stat.total}</span>${deltaSpan(stat.total, prev?.total)}</div>
    ${brandLine(totalBrand)}
  </div>`
}

export function buildRegionClearancePushHtml(params: {
  regionName: string
  stations: RegionStationEntry[]
  pushTimeLabel: string
  yesterdayDateStr: string
  todayDateStr: string
  yesterdayStat: DispatchDeliveredStat
  todayStat: DispatchDeliveredStat
  inventoryStat: InventoryStat
  /** 上一次定时推送的快照；只对「今日数据」「今日库存」两列生效，「昨日数据」是定型数据不展示对比 */
  previousSnapshot?: RegionClearanceSnapshot | null
}): string {
  const {
    regionName,
    stations,
    pushTimeLabel,
    yesterdayDateStr,
    todayDateStr,
    yesterdayStat,
    todayStat,
    inventoryStat,
    previousSnapshot,
  } = params
  const prevToday = previousSnapshot?.todayStat
  const prevInventory = previousSnapshot?.inventoryStat
  const EMPTY_DD = { dispatch: 0, delivered: 0, drivers: 0, dispatchBrand: EMPTY_BRAND, deliveredBrand: EMPTY_BRAND }
  const EMPTY_INV = { inWarehouse: 0, outWarehouse: 0, total: 0, inWarehouseBrand: EMPTY_BRAND, outWarehouseBrand: EMPTY_BRAND }

  const stationRows = stations
    .map(
      (s) => `<tr class="row-station">
        <td><div class="station-cell">${esc(s.name || s.code)}</div></td>
        <td>${dispatchDeliveredCell(yesterdayStat.byStation[s.code] ?? EMPTY_DD)}</td>
        <td>${dispatchDeliveredCell(todayStat.byStation[s.code] ?? EMPTY_DD, prevToday?.byStation[s.code])}</td>
        <td>${inventoryCell(inventoryStat.byStation[s.code] ?? EMPTY_INV, prevInventory?.byStation[s.code])}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap">
<style>
:root{
  --ink:#152033; --ink-soft:#64748b; --paper:#eef4fb; --panel:#ffffff; --line:#d9e3f2;
  --accent:#ff7a1a; --accent2:#2f7cf6;
  --dispatch:#2f7cf6; --delivered:#16c172; --drivers:#9b5cf6;
  --stock-in:#06b6d4; --stock-out:#f5a623;
  --up:#e23b3b; --down:#16a34a;
}
*{box-sizing:border-box;margin:0;}
body{background:var(--paper);color:var(--ink);font-family:'Public Sans',-apple-system,'Segoe UI',sans-serif;display:inline-block;}
/* 截图时按 .wrap 的实际内容边界裁切（见 renderHtmlToImage.ts），不截整页，page 背景不会带进截图 */
.wrap{width:1180px;padding:18px;display:flex;flex-direction:column;gap:16px;}
.num{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}

.head{background:linear-gradient(120deg, var(--accent2), var(--accent));color:#fff;border-radius:16px;padding:24px 28px;}
.head .eyebrow{font:800 13px/1 'Public Sans',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.88);margin-bottom:10px;}
.head h1{font:800 38px/1.1 'Archivo',sans-serif;letter-spacing:-.01em;color:#fff;}
.head .meta{margin-top:14px;font-size:17px;font-weight:600;color:rgba(255,255,255,.92);}
.head .meta b{color:#fff;font-weight:800;}
.head .meta .sep{opacity:.5;margin:0 3px;}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:4px;}
table.matrix{width:100%;border-collapse:collapse;}
.matrix thead th{text-align:left;padding:18px 20px 14px;border-bottom:2px solid var(--line);font:800 15px/1 'Public Sans',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-soft);}
.matrix thead th.col-station{width:14%;}
.matrix thead th .sub{display:block;margin-top:6px;font:600 13px/1.3 'IBM Plex Mono',monospace;letter-spacing:0;text-transform:none;color:var(--ink-soft);}
.matrix td{padding:16px 20px;border-bottom:1px solid var(--line);vertical-align:top;}
.matrix tbody tr:last-child td{border-bottom:none;}

.row-region td{background:linear-gradient(90deg, color-mix(in srgb, var(--accent2) 12%, var(--panel)), color-mix(in srgb, var(--accent) 12%, var(--panel)));}
.station-cell{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.region-name{font:800 26px/1 'Archivo',sans-serif;}
.region-tag{font:800 13px/1 'Public Sans',sans-serif;letter-spacing:.05em;text-transform:uppercase;color:var(--accent);background:color-mix(in srgb, var(--accent) 16%, transparent);padding:5px 10px;border-radius:999px;}
.row-station .station-cell{font:800 19px/1.3 'Public Sans',sans-serif;}

.mcell{display:flex;flex-direction:column;gap:8px;min-width:190px;}
.mrow{display:flex;align-items:center;gap:9px;font-size:17px;}
.mdot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}
.mlabel{color:var(--ink-soft);flex:1;font-weight:700;}
.mval{font-weight:800;font-size:21px;}
.mbrand{margin:-2px 0 0 18px;font:600 14px/1.3 'IBM Plex Mono',monospace;color:var(--ink-soft);}
.mbrand b{color:var(--ink);font-weight:700;}
.mrow-total{margin-top:5px;padding-top:8px;border-top:1px dashed var(--line);}
.mrow-total .mlabel{color:var(--ink);font-weight:800;}
.mrow-total .mval{font-size:23px;}
.row-region .mval{font-size:23px;}
.delta{font:800 14px/1 'IBM Plex Mono',monospace;}
.delta-up{color:var(--up);}
.delta-down{color:var(--down);}
.delta-flat{color:var(--ink-soft);}

.foot{padding:6px 6px 0;font-size:15px;font-weight:600;color:var(--ink-soft);}
</style></head>
<body>
<div class="wrap">
  <div class="head">
    <div class="eyebrow">区域大盘清货数据推送</div>
    <h1>${esc(regionName)}</h1>
    <div class="meta"><b>${esc(pushTimeLabel)}</b> 推送</div>
  </div>

  <div class="panel">
    <table class="matrix">
      <thead>
        <tr>
          <th class="col-station">网点</th>
          <th>昨日数据<span class="sub">${esc(yesterdayDateStr)}</span></th>
          <th>今日数据<span class="sub">${esc(todayDateStr)} 截至推送时刻${previousSnapshot ? ' · 较上次' : ''}</span></th>
          <th>今日库存<span class="sub">已剔除今日入库${previousSnapshot ? ' · 较上次' : ''}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr class="row-region">
          <td><div class="station-cell"><span class="region-name">${esc(regionName)}</span><span class="region-tag">大区合计</span></div></td>
          <td>${dispatchDeliveredCell({
            dispatch: yesterdayStat.dispatchTotal,
            delivered: yesterdayStat.deliveredTotal,
            drivers: yesterdayStat.driverTotal,
            dispatchBrand: yesterdayStat.dispatchBrand,
            deliveredBrand: yesterdayStat.deliveredBrand,
          })}</td>
          <td>${dispatchDeliveredCell(
            {
              dispatch: todayStat.dispatchTotal,
              delivered: todayStat.deliveredTotal,
              drivers: todayStat.driverTotal,
              dispatchBrand: todayStat.dispatchBrand,
              deliveredBrand: todayStat.deliveredBrand,
            },
            prevToday && { dispatch: prevToday.dispatchTotal, delivered: prevToday.deliveredTotal, drivers: prevToday.driverTotal },
          )}</td>
          <td>${inventoryCell(
            {
              inWarehouse: inventoryStat.inWarehouseTotal,
              outWarehouse: inventoryStat.outWarehouseTotal,
              total: inventoryStat.total,
              inWarehouseBrand: inventoryStat.inWarehouseBrand,
              outWarehouseBrand: inventoryStat.outWarehouseBrand,
            },
            prevInventory && { inWarehouse: prevInventory.inWarehouseTotal, outWarehouse: prevInventory.outWarehouseTotal, total: prevInventory.total },
          )}</td>
        </tr>
        ${stationRows}
      </tbody>
    </table>
  </div>

  <div class="foot">${esc(pushTimeLabel)} · iMile Warehouse Management System</div>
</div>
</body></html>`
}
