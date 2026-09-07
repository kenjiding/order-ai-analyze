/** 日常检查表模板行（与纸质表 35 个序号一致） */
export type DailyChecklistTemplateRow = {
  serialNo: number
  category: string
  item: string
  keyPoint: string
}

export const DAILY_CHECKLIST_SERIAL_NOS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35,
] as const

export type DailyChecklistTranslator = (key: string) => string

export function getDailyChecklistTemplate(t: DailyChecklistTranslator): DailyChecklistTemplateRow[] {
  return DAILY_CHECKLIST_SERIAL_NOS.map((serialNo) => ({
    serialNo,
    category: t(`checklist.rows.${serialNo}.category`),
    item: t(`checklist.rows.${serialNo}.item`),
    keyPoint: t(`checklist.rows.${serialNo}.keyPoint`),
  }))
}
