import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImportantNoticeCard } from './feishuMentionHelpers'

const mentions = [{ name: '张三', openId: 'ou_1' }]

/** 独立提醒卡片只有一个 markdown 元素，取它的 content 断言 */
const noticeContent = (notice: string, at: typeof mentions | []): string => {
  const card = buildImportantNoticeCard(notice, at) as {
    body: { elements: Array<{ content?: string }> }
  }
  assert.equal(card.body.elements.length, 1)
  return card.body.elements[0].content ?? ''
}

test('提醒原文原样输出，不加任何标题；勾选 @ 时 @ 人跟在后面', () => {
  assert.equal(noticeContent('今晚 20:00 前必须清完', mentions), '今晚 20:00 前必须清完\n<at id="ou_1"></at>')
})

test('未勾选 @ 时只有提醒原文', () => {
  assert.equal(noticeContent('今晚 20:00 前必须清完', []), '今晚 20:00 前必须清完')
})
