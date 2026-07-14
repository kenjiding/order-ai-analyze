const DISPLAY_NAME_SEP = '/'

function displayNamePart(value: string | null | undefined): string {
  return String(value ?? '').trim() || '-'
}

/** 图表等单字段展示：姓名 > 姓氏 > 昵称，取首个非空值 */
export function pickEmployeeChartLabel(record: {
  name?: string | null
  surname?: string | null
  nickname?: string | null
}): string {
  for (const value of [record.name, record.surname, record.nickname]) {
    const trimmed = String(value ?? '').trim()
    if (trimmed) return trimmed
  }
  return ''
}

/** 考勤/工资记录：姓名/姓氏/昵称 合并为一列展示 */
export function formatEmployeeDisplayName(record: {
  name?: string | null
  surname?: string | null
  nickname?: string | null
}): string {
  const name = displayNamePart(record.name)
  const surname = displayNamePart(record.surname)
  const nickname = displayNamePart(record.nickname)
  if (name === '-' && surname === '-' && nickname === '-') return '-'
  return [name, surname, nickname].join(DISPLAY_NAME_SEP)
}
