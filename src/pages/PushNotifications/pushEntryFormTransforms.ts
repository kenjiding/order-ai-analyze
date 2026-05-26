import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { createPushEntryId } from './feishuPushStorage'
import type { FeishuPushEntry, FeishuPushKind } from './feishuPushTypes'

dayjs.extend(customParseFormat)

export type PushFormRow = Omit<FeishuPushEntry, 'pushTimeHm' | 'signingSecret' | 'pushDescription'> & {
  kind: FeishuPushKind
  pushTimeHm: Dayjs | null | undefined
  isDisabled?: boolean
  signingSecret?: string
  pushDescription?: string
}

export type PushEntryDraft = FeishuPushEntry & { kind: FeishuPushKind }

export function createBlankPushFormRow(defaultKind: FeishuPushKind): PushFormRow {
  return {
    id: createPushEntryId(),
    kind: defaultKind,
    webhookUrl: '',
    pushName: '',
    pushTimeHm: dayjs('09:07', 'HH:mm'),
    isDisabled: false,
    signingSecret: '',
    pushDescription: '',
  }
}

export function entriesToFormRows(entries: FeishuPushEntry[], kind: FeishuPushKind): PushFormRow[] {
  return entries.map((e) => ({
    id: e.id,
    kind,
    webhookUrl: e.webhookUrl,
    pushName: e.pushName,
    pushTimeHm: dayjs(e.pushTimeHm && e.pushTimeHm.length >= 4 ? e.pushTimeHm : '09:07', 'HH:mm'),
    isDisabled: e.isDisabled === true,
    signingSecret: e.signingSecret ?? '',
    pushDescription: e.pushDescription ?? '',
  }))
}

export function formRowsToDrafts(rows: PushFormRow[]): PushEntryDraft[] {
  return rows.map((r) => {
    const hm =
      r.pushTimeHm && dayjs.isDayjs(r.pushTimeHm) && r.pushTimeHm.isValid()
        ? r.pushTimeHm.format('HH:mm')
        : typeof r.pushTimeHm === 'string'
          ? r.pushTimeHm
          : ''
    const secret =
      typeof r.signingSecret === 'string' && r.signingSecret.trim() !== ''
        ? r.signingSecret.trim()
        : undefined
    const desc =
      typeof r.pushDescription === 'string' && r.pushDescription.trim() !== ''
        ? r.pushDescription.trim()
        : undefined
    return {
      id: r.id || createPushEntryId(),
      kind: r.kind,
      webhookUrl: typeof r.webhookUrl === 'string' ? r.webhookUrl.trim() : '',
      pushName: typeof r.pushName === 'string' ? r.pushName.trim() : '',
      pushTimeHm: hm,
      isDisabled: r.isDisabled === true,
      signingSecret: secret,
      pushDescription: desc,
    }
  })
}

export function formRowToDraft(row: PushFormRow): PushEntryDraft {
  return formRowsToDrafts([row])[0]
}
