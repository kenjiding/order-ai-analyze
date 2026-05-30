/// <reference lib="webworker" />

import type { ParsedAllocationRow, ParsedAttendanceRow, ParsedScanRow } from '../aggregates'
import { parseAllocationFileBuffer, parseAttendanceFileBuffer, parseScanFileBuffer } from '../bufferParsers'

export type ExcelParseWorkerRequest =
  | { id: number; kind: 'scan'; buffer: ArrayBuffer; fileName: string }
  | { id: number; kind: 'attendance'; buffer: ArrayBuffer; fileName: string }
  | { id: number; kind: 'allocation'; buffer: ArrayBuffer; fileName: string }

export type ExcelParseWorkerResponse =
  | { id: number; ok: true; kind: 'scan'; rows: ParsedScanRow[]; droppedRows: number }
  | { id: number; ok: true; kind: 'attendance'; rows: ParsedAttendanceRow[]; droppedRows: number }
  | { id: number; ok: true; kind: 'allocation'; rows: ParsedAllocationRow[]; droppedRows: number }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<ExcelParseWorkerRequest>) => {
  const msg = ev.data
  try {
    if (msg.kind === 'scan') {
      const { rows, droppedRows } = parseScanFileBuffer(msg.buffer, msg.fileName)
      const out: ExcelParseWorkerResponse = { id: msg.id, ok: true, kind: 'scan', rows, droppedRows }
      ctx.postMessage(out)
    } else if (msg.kind === 'attendance') {
      const { rows, droppedRows } = parseAttendanceFileBuffer(msg.buffer, msg.fileName)
      const out: ExcelParseWorkerResponse = { id: msg.id, ok: true, kind: 'attendance', rows, droppedRows }
      ctx.postMessage(out)
    } else {
      const { rows, droppedRows } = parseAllocationFileBuffer(msg.buffer, msg.fileName)
      const out: ExcelParseWorkerResponse = { id: msg.id, ok: true, kind: 'allocation', rows, droppedRows }
      ctx.postMessage(out)
    }
  } catch (e) {
    const out: ExcelParseWorkerResponse = {
      id: msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
    ctx.postMessage(out)
  }
}
