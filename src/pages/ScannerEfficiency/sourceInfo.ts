export type SourceInfo = {
  fileCount: number
  /** 进入统计的行数（已按运单号去重合并后） */
  rowCount: number
  droppedRows: number
  /** 解析有效但运单号与更早一条重复而剔除的行数 */
  duplicateWaybillRows: number
  fileNames: string[]
}
