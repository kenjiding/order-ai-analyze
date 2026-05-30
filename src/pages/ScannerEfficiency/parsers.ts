import type { ParsedAllocationRow, ParsedAttendanceRow, ParsedScanRow } from './aggregates'
import {
  flushPaint,
  parseAllocationBufferInWorker,
  parseAttendanceBufferInWorker,
  parseScanBufferInWorker,
} from './excelParseClient'

export async function parseScanFiles(files: File[]): Promise<{
  rows: ParsedScanRow[]
  droppedRows: number
  fileNames: string[]
}> {
  await flushPaint()

  const rows: ParsedScanRow[] = []
  let droppedRows = 0

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const part = await parseScanBufferInWorker(buffer, file.name)
    for (const row of part.rows) {
      rows.push(row)
    }
    droppedRows += part.droppedRows
  }

  return {
    rows,
    droppedRows,
    fileNames: files.map((file) => file.name),
  }
}

export async function parseAttendanceFiles(files: File[]): Promise<{
  rows: ParsedAttendanceRow[]
  droppedRows: number
  fileNames: string[]
}> {
  await flushPaint()

  const rows: ParsedAttendanceRow[] = []
  let droppedRows = 0

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const part = await parseAttendanceBufferInWorker(buffer, file.name)
    for (const row of part.rows) {
      rows.push(row)
    }
    droppedRows += part.droppedRows
  }

  return {
    rows,
    droppedRows,
    fileNames: files.map((file) => file.name),
  }
}

export async function parseAllocationFiles(files: File[]): Promise<{
  rows: ParsedAllocationRow[]
  droppedRows: number
  fileNames: string[]
}> {
  await flushPaint()

  const rows: ParsedAllocationRow[] = []
  let droppedRows = 0

  for (const file of files) {
    const buffer = await file.arrayBuffer()
    const part = await parseAllocationBufferInWorker(buffer, file.name)
    for (const row of part.rows) {
      rows.push(row)
    }
    droppedRows += part.droppedRows
  }

  return {
    rows,
    droppedRows,
    fileNames: files.map((file) => file.name),
  }
}
