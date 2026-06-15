/**
 * DA 仓外库存数据拉取与 Excel 导出（由 da_inventory_data.py 转换）
 *
 * 用法：在项目根目录执行
 *   node da_inventory_data.js
 *
 * 依赖：exceljs（已在 package.json 中）
 * 运行前请设置 TOKEN 常量。
 */

import ExcelJS from 'exceljs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const TOKEN = 'a0e13801-64e0-4179-90c5-950142259759'

const OC_CENTER_CODE = 'S210206'
const COUNTRY = 'AUS'
const TIMEZONE = '+10'

const PAGE_SIZE = 50000
const WAYBILL_BATCH_SIZE = 1000

const inventoryUrl = 'https://oc.imile.com/saastms/v1/report/stock/daWaybillInventory'
const waybillUrl = 'https://oc.imile.com/saastms/v1/biz/waybillInfo/searchWaybill'
const organizationUrl = 'https://oc.imile.com/lm/express/base/v1/biz/organization/getOrganizationByCode'

const baseHeaders = {
  authorization: `Bearer ${TOKEN}`,
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'front-sec': '{"orgId":10,"entId":10,"userCode":"2103269901","moduleId":10007,"client":"pc"}',
  hubcode: OC_CENTER_CODE,
  lang: 'zh_CN',
  origin: 'https://oc.imile.com',
  referer: 'https://oc.imile.com/',
  'sys-name': 'DS',
  'sys-portal': 'OC',
  timezone: TIMEZONE,
}

const inventoryHeaders = { ...baseHeaders, 'resource-code': 'DAInventory' }
const waybillHeaders = { ...baseHeaders, 'resource-code': 'CentralWaybillQuery' }
const organizationHeaders = { ...baseHeaders, 'resource-code': 'OrganizationalManagement' }

const requestCount = {
  仓外库存报表: 0,
  中心运单查询: 0,
  网点组织信息: 0,
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function formatTimestamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}`
}

async function safeJson(response) {
  try {
    return await response.json()
  } catch {
    const text = await response.text()
    return { status: 'failure', message: text }
  }
}

function* batchList(values, size) {
  for (let i = 0; i < values.length; i += size) {
    yield values.slice(i, i + size)
  }
}

function findResultObject(data) {
  return data?.resultObject ?? data?.data ?? data?.result ?? {}
}

function findRows(resultObject) {
  if (Array.isArray(resultObject)) {
    return resultObject
  }

  if (!resultObject || typeof resultObject !== 'object') {
    return []
  }

  for (const key of ['results', 'records', 'rows', 'list', 'dataList', 'pageData', 'items']) {
    const value = resultObject[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  for (const value of Object.values(resultObject)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rows = findRows(value)
      if (rows.length) {
        return rows
      }
    }
  }

  return []
}

function findTotalPage(resultObject, rowCount, pageSize) {
  if (!resultObject || typeof resultObject !== 'object' || Array.isArray(resultObject)) {
    return 1
  }

  const pagination = resultObject.pagination ?? {}
  if (pagination && typeof pagination === 'object' && pagination.totalPage) {
    return Number(pagination.totalPage)
  }

  for (const key of ['totalPage', 'pages']) {
    const value = resultObject[key]
    if (value) {
      return Number(value)
    }
  }

  let total = null
  for (const key of ['total', 'totalCount', 'count', 'recordCount']) {
    const value = resultObject[key]
    if (value) {
      total = Number(value)
      break
    }
  }

  if (total) {
    return Math.max(1, Math.ceil(total / pageSize))
  }

  return rowCount < pageSize ? 1 : 999999
}

function containsDc(stationTypes) {
  if (stationTypes == null) {
    return false
  }

  if (typeof stationTypes === 'string') {
    return stationTypes.toUpperCase().includes('DC')
  }

  if (Array.isArray(stationTypes)) {
    for (const item of stationTypes) {
      if (typeof item === 'string' && item.toUpperCase().includes('DC')) {
        return true
      }
      if (item && typeof item === 'object') {
        const text = Object.values(item).join(' ')
        if (text.toUpperCase().includes('DC')) {
          return true
        }
      }
    }
  }

  return false
}

function findRouteValue(row) {
  for (const col of [
    'consigneeRouteCode',
    'routeCode',
    'dispatchRouteCode',
    'deliveryRouteCode',
    'route_code',
  ]) {
    const value = row[col]
    if (value != null && String(value).trim() !== '') {
      return value
    }
  }
  return ''
}

function getInventoryCol(row, colName) {
  return row[colName] ?? ''
}

function buildNotReturnedRange(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return ''
  }

  const n = Number(value)

  if (n < 0) return String(n)
  if (n === 0) return '0D'
  if (n === 1) return '1D'
  if (n === 2) return '2D'
  if (n === 3) return '3D'
  if (n === 4) return '4D'
  if (n === 5) return '5D'
  if (n === 6) return '6D'
  if (n === 7) return '7D'

  return '>7D'
}

function strVal(v) {
  return v == null ? '' : String(v).trim()
}

function excludeTestRegion(rows) {
  return rows.filter((row) => !strVal(row['大区']).toLowerCase().includes('test'))
}

function sumColumns(row, columns) {
  return columns.reduce((sum, col) => sum + Number(row[col] ?? 0), 0)
}

function buildStationSummary(df) {
  const rangeOrder = ['0D', '1D', '2D', '3D', '4D', '5D', '6D', '7D', '>7D']
  const outputColumns = ['大区', '网点', ...rangeOrder, 'Grand Total']

  let source = df.filter((row) => strVal(row['最新扫描类型']) === '派件')
  source = excludeTestRegion(source)
  source = source.filter((row) => rangeOrder.includes(strVal(row['未归班天范围'])))

  if (!source.length) {
    return []
  }

  const pivotMap = new Map()

  for (const row of source) {
    const region = strVal(row['大区'])
    const station = strVal(row.stockStationName)
    const range = strVal(row['未归班天范围'])
    const key = `${region}\0${station}`

    if (!pivotMap.has(key)) {
      pivotMap.set(key, {
        大区: region,
        stockStationName: station,
        counts: Object.fromEntries(rangeOrder.map((r) => [r, 0])),
      })
    }

    pivotMap.get(key).counts[range] += 1
  }

  const pivot = [...pivotMap.values()].map((item) => {
    const row = {
      大区: item['大区'],
      stockStationName: item.stockStationName,
      ...item.counts,
    }
    row['Grand Total'] = sumColumns(row, rangeOrder)
    return row
  })

  const rows = []
  const regions = [...new Set(pivot.map((row) => strVal(row['大区'])))].sort()

  for (const region of regions) {
    const regionRows = pivot.filter((row) => strVal(row['大区']) === region)

    const subtotalRow = { 大区: region || '未识别大区', 网点: '' }
    for (const col of [...rangeOrder, 'Grand Total']) {
      subtotalRow[col] = regionRows.reduce((sum, row) => sum + Number(row[col] ?? 0), 0)
    }
    rows.push(subtotalRow)

    for (const row of regionRows.sort((a, b) =>
      strVal(a.stockStationName).localeCompare(strVal(b.stockStationName)),
    )) {
      const detailRow = { 大区: '', 网点: row.stockStationName }
      for (const col of [...rangeOrder, 'Grand Total']) {
        detailRow[col] = Number(row[col] ?? 0)
      }
      rows.push(detailRow)
    }
  }

  const grandTotalRow = { 大区: 'Grand Total', 网点: '' }
  for (const col of [...rangeOrder, 'Grand Total']) {
    grandTotalRow[col] = pivot.reduce((sum, row) => sum + Number(row[col] ?? 0), 0)
  }
  rows.push(grandTotalRow)

  return rows.map((row) => {
    const out = {}
    for (const col of outputColumns) {
      out[col] = row[col] ?? ''
    }
    return out
  })
}

function buildDriverSummary(df) {
  const rangeOrder = ['2D', '3D', '4D', '5D', '6D', '7D', '>7D']
  const outputColumns = ['大区', '网点', '司机', '供应商', '路由', ...rangeOrder, 'Grand Total']

  let source = df.filter((row) => strVal(row['最新扫描类型']) === '派件')
  source = excludeTestRegion(source)
  source = source.filter((row) => rangeOrder.includes(strVal(row['未归班天范围'])))

  if (!source.length) {
    return []
  }

  source = source.map((row) => ({
    ...row,
    driverName: strVal(row.driverName),
    driverVendorName: strVal(row.driverVendorName),
    路由码: strVal(row['路由码']),
  }))

  const driverTotalMap = new Map()
  for (const row of source) {
    const key = `${strVal(row['大区'])}\0${strVal(row.stockStationName)}\0${row.driverName}\0${row.driverVendorName}`
    driverTotalMap.set(key, (driverTotalMap.get(key) ?? 0) + 1)
  }

  const qualifiedKeys = new Set(
    [...driverTotalMap.entries()].filter(([, total]) => total > 10).map(([key]) => key),
  )

  if (!qualifiedKeys.size) {
    return []
  }

  source = source.filter((row) => {
    const key = `${strVal(row['大区'])}\0${strVal(row.stockStationName)}\0${row.driverName}\0${row.driverVendorName}`
    return qualifiedKeys.has(key)
  })

  const pivotMap = new Map()

  for (const row of source) {
    const key = [
      strVal(row['大区']),
      strVal(row.stockStationName),
      row.driverName,
      row.driverVendorName,
      row['路由码'],
      strVal(row['未归班天范围']),
    ].join('\0')

    if (!pivotMap.has(key)) {
      pivotMap.set(key, {
        大区: strVal(row['大区']),
        stockStationName: strVal(row.stockStationName),
        driverName: row.driverName,
        driverVendorName: row.driverVendorName,
        路由码: row['路由码'],
        range: strVal(row['未归班天范围']),
        count: 0,
      })
    }

    pivotMap.get(key).count += 1
  }

  const grouped = new Map()

  for (const item of pivotMap.values()) {
    const groupKey = [
      item['大区'],
      item.stockStationName,
      item.driverName,
      item.driverVendorName,
      item['路由码'],
    ].join('\0')

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        大区: item['大区'],
        stockStationName: item.stockStationName,
        driverName: item.driverName,
        driverVendorName: item.driverVendorName,
        路由码: item['路由码'],
        counts: Object.fromEntries(rangeOrder.map((r) => [r, 0])),
      })
    }

    grouped.get(groupKey).counts[item.range] += item.count
  }

  const pivot = [...grouped.values()].map((item) => {
    const row = {
      大区: item['大区'],
      网点: item.stockStationName,
      司机: item.driverName,
      供应商: item.driverVendorName,
      路由: item['路由码'],
      ...item.counts,
    }
    row['Grand Total'] = sumColumns(row, rangeOrder)
    return row
  })

  pivot.sort((a, b) => {
    for (const key of ['大区', '网点', '司机', '供应商']) {
      const cmp = strVal(a[key]).localeCompare(strVal(b[key]))
      if (cmp !== 0) return cmp
    }
    return Number(b['Grand Total']) - Number(a['Grand Total'])
  })

  return pivot.map((row) => {
    const out = {}
    for (const col of outputColumns) {
      out[col] = row[col] ?? ''
    }
    return out
  })
}

function thinBorder(color = 'FFB7B7B7') {
  return {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
  }
}

function mergeSameCellsByKey(sheet, targetCol, keyCols, startRow = 3) {
  const maxRow = sheet.rowCount
  if (maxRow < startRow) {
    return
  }

  const cachedRows = {}
  for (let rowIdx = startRow; rowIdx <= maxRow; rowIdx += 1) {
    cachedRows[rowIdx] = {}
    for (const colIdx of keyCols) {
      cachedRows[rowIdx][colIdx] = sheet.getCell(rowIdx, colIdx).value
    }
  }

  let groupStart = startRow
  let previousKey = keyCols.map((colIdx) => cachedRows[startRow][colIdx]).join('\0')

  for (let rowIdx = startRow + 1; rowIdx <= maxRow + 1; rowIdx += 1) {
    let currentKey = null
    if (rowIdx <= maxRow) {
      currentKey = keyCols.map((colIdx) => cachedRows[rowIdx][colIdx]).join('\0')
    }

    if (currentKey !== previousKey) {
      const groupEnd = rowIdx - 1

      if (groupEnd > groupStart) {
        sheet.mergeCells(groupStart, targetCol, groupEnd, targetCol)
        sheet.getCell(groupStart, targetCol).alignment = { horizontal: 'center', vertical: 'middle' }
      }

      groupStart = rowIdx
      previousKey = currentKey
    }
  }
}

function mergeDriverSummaryCells(sheet) {
  mergeSameCellsByKey(sheet, 1, [1], 3)
  mergeSameCellsByKey(sheet, 2, [1, 2], 3)
  mergeSameCellsByKey(sheet, 3, [1, 2, 3], 3)
}

function styleSheetCommon(sheet, headerRow, border, headerFill, whiteFont) {
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: sheet.rowCount, column: sheet.columnCount },
  }

  for (let col = 1; col <= sheet.columnCount; col += 1) {
    const cell = sheet.getCell(headerRow, col)
    cell.fill = headerFill
    cell.font = whiteFont
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = border
  }

  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border
      cell.alignment = { ...(cell.alignment ?? {}), vertical: 'middle' }
    })
  })

  for (let colIdx = 1; colIdx <= sheet.columnCount; colIdx += 1) {
    let maxLength = 0
    sheet.getColumn(colIdx).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value != null) {
        maxLength = Math.max(maxLength, String(cell.value).length)
      }
    })
    sheet.getColumn(colIdx).width = Math.min(Math.max(maxLength + 2, 10), 30)
  }
}

async function styleExcel(filePath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const headerFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF5B7FA6' },
  }
  const titleFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E78' },
  }
  const regionFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9EAF7' },
  }
  const totalFill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2F3A4A' },
  }

  const whiteFont = { color: { argb: 'FFFFFFFF' }, bold: true }
  const titleFont = { color: { argb: 'FFFFFFFF' }, bold: true, size: 14 }
  const boldFont = { color: { argb: 'FF000000' }, bold: true }
  const border = thinBorder()

  for (const sheet of workbook.worksheets) {
    const sheetName = sheet.name
    let headerRow = 1

    if (sheetName === '网点汇总' || sheetName === '司机汇总') {
      sheet.views = [{ state: 'frozen', ySplit: 2 }]
      const maxCol = sheet.columnCount
      sheet.mergeCells(1, 1, 1, maxCol)

      const titleCell = sheet.getCell(1, 1)
      titleCell.fill = titleFill
      titleCell.font = titleFont
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
      titleCell.border = border
      sheet.getRow(1).height = 30
      headerRow = 2
    } else {
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
    }

    styleSheetCommon(sheet, headerRow, border, headerFill, whiteFont)

    if (sheetName === '网点汇总') {
      for (let rowIdx = 3; rowIdx <= sheet.rowCount; rowIdx += 1) {
        const regionValue = sheet.getCell(rowIdx, 1).value
        const isGrandTotal = regionValue === 'Grand Total'
        const isRegionTotal = regionValue != null && regionValue !== '' && regionValue !== 'Grand Total'

        for (let colIdx = 1; colIdx <= sheet.columnCount; colIdx += 1) {
          const cell = sheet.getCell(rowIdx, colIdx)

          if (colIdx >= 3) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' }
          }

          if (isGrandTotal) {
            cell.fill = totalFill
            cell.font = whiteFont
          } else if (isRegionTotal) {
            cell.fill = regionFill
            cell.font = boldFont
          }
        }
      }
    }

    if (sheetName === '司机汇总') {
      mergeDriverSummaryCells(sheet)

      for (let rowIdx = 3; rowIdx <= sheet.rowCount; rowIdx += 1) {
        for (let colIdx = 6; colIdx <= sheet.columnCount; colIdx += 1) {
          sheet.getCell(rowIdx, colIdx).alignment = { horizontal: 'right', vertical: 'middle' }
        }
      }
    }
  }

  await workbook.xlsx.writeFile(filePath)
}

function writeSheetRows(sheet, rows, startRow = 1) {
  if (!rows.length) {
    return
  }

  const headers = Object.keys(rows[0])
  headers.forEach((header, idx) => {
    sheet.getCell(startRow, idx + 1).value = header
  })

  rows.forEach((row, rowIdx) => {
    headers.forEach((header, colIdx) => {
      sheet.getCell(startRow + 1 + rowIdx, colIdx + 1).value = row[header]
    })
  })
}

async function exportWorkbook(outputFile, rawRows, stationSummary, driverSummary, todayText) {
  const workbook = new ExcelJS.Workbook()

  const rawSheet = workbook.addWorksheet('Rawdata')
  writeSheetRows(rawSheet, rawRows, 1)

  const stationSheet = workbook.addWorksheet('网点汇总')
  stationSheet.getCell(1, 1).value = `${todayText} 仓外库存`
  writeSheetRows(stationSheet, stationSummary, 2)

  const driverSheet = workbook.addWorksheet('司机汇总')
  driverSheet.getCell(1, 1).value = `${todayText} 超2天&超10件派件未归班`
  writeSheetRows(driverSheet, driverSummary, 2)

  await workbook.xlsx.writeFile(outputFile)
  await styleExcel(outputFile)
}

async function main() {
  const now = new Date()
  const todayText = formatDate(now)
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const outputDir = path.join(os.homedir(), 'Downloads')
  const fileName = formatTimestamp(now)
  const outputFile = path.join(outputDir, `${fileName}_DAInventory_Selected_Rawdata.xlsx`)

  // 1. 查询仓外库存
  const allRows = []
  const payload = {
    currentPage: 1,
    showCount: PAGE_SIZE,
    orderTypes: [],
    stockReportType: 'allTotal',
    scanType: '',
    scanTypeList: [],
    stockStationCodes: [],
    ocCenterCode: OC_CENTER_CODE,
    country: COUNTRY,
    fromOc: true,
  }

  let response = await fetch(inventoryUrl, {
    method: 'POST',
    headers: inventoryHeaders,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  })
  requestCount['仓外库存报表'] += 1
  let data = await safeJson(response)

  let resultObject = findResultObject(data)
  let firstRows = findRows(resultObject)

  if (!resultObject && !firstRows.length) {
    throw new Error(`仓外库存报表接口返回异常：${JSON.stringify(data)}`)
  }

  let totalPage = findTotalPage(resultObject, firstRows.length, PAGE_SIZE)
  console.log(`仓外库存报表总页数：${totalPage}`)

  allRows.push(...firstRows)
  console.log(`第 1 页返回：${firstRows.length} 条`)

  for (let page = 2; page <= totalPage; page += 1) {
    payload.currentPage = page

    response = await fetch(inventoryUrl, {
      method: 'POST',
      headers: inventoryHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    })
    requestCount['仓外库存报表'] += 1
    data = await safeJson(response)

    resultObject = findResultObject(data)
    const rows = findRows(resultObject)

    if (!rows.length) {
      console.log(`第 ${page} 页没有返回明细，停止分页`)
      break
    }

    allRows.push(...rows)
    console.log(`第 ${page} 页返回：${rows.length} 条，目前共 ${allRows.length} 条`)

    if (rows.length < PAGE_SIZE) {
      break
    }

    await sleep(200)
  }

  if (!allRows.length) {
    throw new Error('没有抓到任何数据，请检查 TOKEN、网点编码。')
  }

  console.log(`仓外库存记录数：${allRows.length}`)

  if (!Object.prototype.hasOwnProperty.call(allRows[0], 'stockStationCode')) {
    throw new Error('接口结果里没有 stockStationCode 字段，无法准确查询大区。')
  }

  // 2. 整理基础字段
  const outputDf = allRows.map((row) => ({
    stockStationCode: getInventoryCol(row, 'stockStationCode'),
    stockStationName: getInventoryCol(row, 'stockStationName'),
    ofdDate: getInventoryCol(row, 'ofdDate'),
    waybillNo: getInventoryCol(row, 'waybillNo'),
    driverName: getInventoryCol(row, 'driverName'),
    driverVendorName: getInventoryCol(row, 'driverVendorName'),
    clientName: getInventoryCol(row, 'clientName'),
    deliveryStationName: getInventoryCol(row, 'deliveryStationName'),
    deliveryCount: getInventoryCol(row, 'deliveryCount'),
    最新扫描类型: getInventoryCol(row, 'lastScanTypeDesc'),
  }))

  if (outputDf.every((row) => strVal(row.waybillNo) === '')) {
    throw new Error('接口结果里没有有效 waybillNo，无法查询路由码。')
  }

  // 3. 用 waybillNo 查询中心运单，补路由码
  const waybillList = [...new Set(outputDf.map((row) => strVal(row.waybillNo)).filter(Boolean))]

  console.log(`准备查询路由码运单数：${waybillList.length}`)

  const routeMap = {}
  const failedWaybillBatches = []
  const maxRetry = 3
  const startTime = '2020-01-01 00:00:00'
  const endTime = `${formatDate(now)} 23:59:59`

  const waybillBatches = [...batchList(waybillList, WAYBILL_BATCH_SIZE)]
  const totalWaybillBatches = waybillBatches.length

  for (let batchIndex = 0; batchIndex < waybillBatches.length; batchIndex += 1) {
    const batch = waybillBatches[batchIndex]
    const waybillPayload = {
      currentPage: 1,
      showCount: WAYBILL_BATCH_SIZE,
      waybillNos: batch,
      referenceNos: [],
      labelOrderCodes: [],
      mainWaybillNos: [],
      platformNos: [],
      dateSearchType: 'waybill',
      startTime,
      endTime,
      actualReceiveStation: '',
    }

    let success = false

    for (let retry = 1; retry <= maxRetry; retry += 1) {
      try {
        response = await fetch(waybillUrl, {
          method: 'POST',
          headers: waybillHeaders,
          body: JSON.stringify(waybillPayload),
          signal: AbortSignal.timeout(60000),
        })
        requestCount['中心运单查询'] += 1
        data = await safeJson(response)

        resultObject = findResultObject(data)
        const rows = findRows(resultObject)

        if (!rows.length) {
          console.log(`中心运单第 ${batchIndex + 1}/${totalWaybillBatches} 批无数据，第 ${retry} 次`)
          await sleep(1000)
          continue
        }

        for (const row of rows) {
          const waybillNo = strVal(row.waybillNo)
          const routeCode = findRouteValue(row)
          if (waybillNo) {
            routeMap[waybillNo] = routeCode
          }
        }

        success = true
        break
      } catch (error) {
        console.log(
          `中心运单第 ${batchIndex + 1}/${totalWaybillBatches} 批异常，第 ${retry} 次：${error.message}`,
        )
        await sleep(1000)
      }
    }

    if (!success) {
      failedWaybillBatches.push(batch)
    }

    console.log(
      `路由码进度：${batchIndex + 1}/${totalWaybillBatches} 批，已匹配 ${Object.keys(routeMap).length} 条`,
    )
    await sleep(200)
  }

  for (const row of outputDf) {
    row['路由码'] = routeMap[strVal(row.waybillNo)] ?? ''
  }

  // 4. 用 stockStationCode 查询网点组织信息，补大区
  const stationInfoMap = new Map()
  for (const row of outputDf) {
    const code = strVal(row.stockStationCode)
    const name = strVal(row.stockStationName)
    if (!code) continue
    if (!stationInfoMap.has(code)) {
      stationInfoMap.set(code, name)
    }
  }

  const regionMapByCode = {}
  const regionMapByName = {}
  const stationEntries = [...stationInfoMap.entries()]

  for (let idx = 0; idx < stationEntries.length; idx += 1) {
    const [stockStationCode, stockStationName] = stationEntries[idx]

    try {
      const url = new URL(organizationUrl)
      url.searchParams.set('code', stockStationCode)

      response = await fetch(url, {
        method: 'GET',
        headers: organizationHeaders,
        signal: AbortSignal.timeout(30000),
      })
      requestCount['网点组织信息'] += 1
      data = await safeJson(response)

      const orgInfo = data?.resultObject ?? data?.data ?? {}

      const organizationName =
        orgInfo.organizationName ?? orgInfo.stationName ?? stockStationName

      const parentStationName =
        orgInfo.parent_station_name ?? orgInfo.parentStationName ?? ''

      const stationTypes = orgInfo.station_types ?? orgInfo.stationTypes ?? []

      const regionName = containsDc(stationTypes) ? stockStationName : parentStationName

      console.log(
        `大区匹配：${stockStationName} / ${stockStationCode} -> parentStationName=${parentStationName}, stationTypes=${JSON.stringify(stationTypes)}, 大区=${regionName}`,
      )

      if (regionName) {
        regionMapByCode[stockStationCode] = regionName
        regionMapByName[stockStationName] = regionName
        regionMapByName[organizationName] = regionName
      }
    } catch (error) {
      console.log(
        `网点组织信息查询异常，stockStationName=${stockStationName}, stockStationCode=${stockStationCode}：${error.message}`,
      )
    }

    if ((idx + 1) % 20 === 0 || idx + 1 === stationEntries.length) {
      console.log(`网点组织信息进度：${idx + 1}/${stationEntries.length}`)
    }

    await sleep(100)
  }

  for (const row of outputDf) {
    const code = strVal(row.stockStationCode)
    let region = regionMapByCode[code] ?? ''
    if (!region) {
      region = regionMapByName[strVal(row.stockStationName)] ?? ''
    }
    row['大区'] = region
  }

  // 5. 添加未归班天数、未归班天范围
  for (const row of outputDf) {
    const ofd = new Date(row.ofdDate)
    if (Number.isNaN(ofd.getTime())) {
      row['未归班天数'] = null
      row['未归班天范围'] = ''
      continue
    }

    const ofdDay = new Date(ofd.getFullYear(), ofd.getMonth(), ofd.getDate())
    const days = Math.floor((todayDate - ofdDay) / 86400000)
    row['未归班天数'] = days
    row['未归班天范围'] = buildNotReturnedRange(days)
  }

  // 6. 整理字段顺序
  const finalColumns = [
    '大区',
    'stockStationName',
    'ofdDate',
    '未归班天数',
    '未归班天范围',
    'waybillNo',
    '路由码',
    '最新扫描类型',
    'driverName',
    'driverVendorName',
    'clientName',
    'deliveryStationName',
    'deliveryCount',
  ]

  const outputRows = outputDf.map((row) => {
    const out = {}
    for (const col of finalColumns) {
      out[col] = row[col] ?? ''
    }
    return out
  })

  // 7. 生成汇总
  const stationSummaryTable = buildStationSummary(outputRows)
  const driverSummaryTable = buildDriverSummary(outputRows)

  // 8. 导出 Excel
  await fs.mkdir(outputDir, { recursive: true })
  await exportWorkbook(outputFile, outputRows, stationSummaryTable, driverSummaryTable, todayText)

  if (failedWaybillBatches.length) {
    const failedFile = path.join(outputDir, `${fileName}_failed_waybill_batches.txt`)
    const content = failedWaybillBatches.map((batch) => batch.join(',')).join('\n')
    await fs.writeFile(failedFile, content, 'utf8')
    console.log(`失败批次已保存：${failedFile}`)
  }

  const routeMatchCount = outputRows.filter((row) => strVal(row['路由码']) !== '').length
  const regionMatchCount = outputRows.filter((row) => strVal(row['大区']) !== '').length

  console.log(`导出完成：${outputFile}`)
  console.log(`导出记录数：${outputRows.length}`)
  console.log(`路由码匹配数：${routeMatchCount}`)
  console.log(`大区匹配数：${regionMatchCount}`)
  console.log(`网点汇总行数：${stationSummaryTable.length}`)
  console.log(`司机汇总行数：${driverSummaryTable.length}`)
  console.log(`请求次数：${JSON.stringify(requestCount)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
