/**
 * 在已打开本站（如同源 http://localhost:5173）的页面 DevTools → Console 粘贴运行，
 * 导出「车队供应商推送」配置为 JSON + CSV。
 *
 * 读取顺序：IndexedDB · warehouse-fleet-supplier-push / fleetSupplierDocs / suppliers.v1，
 * 若无数据再尝试历史 localStorage 键 warehouse.fleetSupplierPush.suppliers.v1。
 */
;(function exportFleetSupplierConfig() {
  var DB_NAME = 'warehouse-fleet-supplier-push'
  var DB_VERSION = 1
  var STORE = 'fleetSupplierDocs'
  var DOC_KEY = 'suppliers.v1'
  var LEGACY_LS_KEY = 'warehouse.fleetSupplierPush.suppliers.v1'

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function escCell(v) {
    if (v == null) return ''
    var s = String(v)
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }

  function finish(rows) {
    if (!rows || !Array.isArray(rows) || !rows.length) {
      console.warn('[fleet-supplier] 未发现供应商列表数据')
      return
    }

    downloadText('fleet-supplier-config.json', JSON.stringify(rows, null, 2), 'application/json')

    var headers = ['id', 'supplierName', 'routeCode', 'webhookUrl', 'signingSecret', 'pushContent']
    var lines = [headers.join(',')]
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {}
      lines.push(
        headers
          .map(function (h) {
            return escCell(r[h])
          })
          .join(','),
      )
    }
    var csv = '\uFEFF' + lines.join('\r\n')
    downloadText('fleet-supplier-config.csv', csv, 'text/csv;charset=utf-8')

    console.log('[fleet-supplier] 已下载 json/csv，共', rows.length, '条')
  }

  function tryLegacyLocalStorage() {
    try {
      var raw = localStorage.getItem(LEGACY_LS_KEY)
      if (!raw) return
      var rows = JSON.parse(raw)
      if (Array.isArray(rows)) finish(rows)
    } catch (e) {
      console.error('[fleet-supplier] localStorage 解析失败', e)
    }
  }

  if (typeof indexedDB === 'undefined') {
    tryLegacyLocalStorage()
    return
  }

  var req = indexedDB.open(DB_NAME, DB_VERSION)
  req.onupgradeneeded = function (e) {
    var db = e.target.result
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
  }
  req.onerror = function () {
    console.error('[fleet-supplier] IndexedDB 打开失败', req.error)
    tryLegacyLocalStorage()
  }
  req.onsuccess = function () {
    var db = req.result
    if (!db.objectStoreNames.contains(STORE)) {
      db.close()
      tryLegacyLocalStorage()
      return
    }
    var tx = db.transaction(STORE, 'readonly')
    var g = tx.objectStore(STORE).get(DOC_KEY)
    g.onsuccess = function () {
      var rows = g.result
      db.close()
      if (rows && Array.isArray(rows) && rows.length) {
        finish(rows)
      } else {
        tryLegacyLocalStorage()
      }
    }
    g.onerror = function () {
      db.close()
      tryLegacyLocalStorage()
    }
  }
})()
