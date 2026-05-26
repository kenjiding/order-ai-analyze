import type { ParsedAttendanceRow, ParsedScanRow } from './aggregates'
import type { ExcelParseWorkerRequest, ExcelParseWorkerResponse } from './workers/excelParse.worker'
import { parseAttendanceFileBuffer, parseScanFileBuffer } from './bufferParsers'

/** 让浏览器先完成一帧绘制（例如显示 loading），再开始重 CPU 任务 */
export function flushPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<
  number,
  {
    resolve: (v: ExcelParseWorkerResponse) => void
    reject: (e: Error) => void
  }
>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./workers/excelParse.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<ExcelParseWorkerResponse>) => {
      const data = ev.data
      const p = pending.get(data.id)
      if (!p) return
      pending.delete(data.id)
      if (data.ok === false) {
        p.reject(new Error(data.error))
      } else {
        p.resolve(data)
      }
    }
    worker.onmessageerror = () => {
      pending.forEach((p) => p.reject(new Error('Worker message error')))
      pending.clear()
    }
  }
  return worker
}

function postToWorker(payload: ExcelParseWorkerRequest): Promise<ExcelParseWorkerResponse> {
  return new Promise((resolve, reject) => {
    const w = getWorker()
    pending.set(payload.id, { resolve, reject })
    // 不传 transferable：保留主线程中的 ArrayBuffer，便于 Worker 失败时主线程兜底解析
    w.postMessage(payload)
  })
}

export async function parseScanBufferInWorker(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<{ rows: ParsedScanRow[]; droppedRows: number }> {
  if (typeof Worker === 'undefined') {
    return parseScanFileBuffer(buffer, fileName)
  }
  const id = ++seq
  try {
    const res = await postToWorker({ id, kind: 'scan', buffer, fileName })
    if (res.ok !== true || res.kind !== 'scan') {
      throw new Error('Unexpected worker response')
    }
    return { rows: res.rows, droppedRows: res.droppedRows }
  } catch {
    return parseScanFileBuffer(buffer, fileName)
  }
}

export async function parseAttendanceBufferInWorker(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<{ rows: ParsedAttendanceRow[]; droppedRows: number }> {
  if (typeof Worker === 'undefined') {
    return parseAttendanceFileBuffer(buffer, fileName)
  }
  const id = ++seq
  try {
    const res = await postToWorker({ id, kind: 'attendance', buffer, fileName })
    if (res.ok !== true || res.kind !== 'attendance') {
      throw new Error('Unexpected worker response')
    }
    return { rows: res.rows, droppedRows: res.droppedRows }
  } catch {
    return parseAttendanceFileBuffer(buffer, fileName)
  }
}
